import * as $ from 'jquery';
import * as Snap from 'snapsvg';
$(() => {
    console.log('loaded');
});

declare global {
    interface Window {
        map_data_callback: any;
    }
}

class CalcTime {
    constructor(private map_data: any) {
        console.log(map_data);
    }

    calcTime(start_station_id) {
        //calculate time to each station from the station
        var graph = this._createEdges(start_station_id);
        var shortest_path = this._findShortestPath(graph);
        var station_cost = this._distanceForEachStation(shortest_path);
        return station_cost;
    }

    _createEdges(start_station_id) {
        //create graph
        var edges = {};//[from][to] = distance
        var max_vertex_id = 0;
        for (var line_id = 0; line_id < this.map_data.lines.length; line_id++) {
            var line_edges = this.map_data.lines[line_id].edges;
            for (var edge_idx = 0; edge_idx < line_edges.length; edge_idx++) {
                var edge = line_edges[edge_idx];
                var v1 = edge[0];
                var v2 = edge[1];
                var dist = edge[2];

                if (!(v1 in edges)) {
                    edges[v1] = {};
                }
                edges[v1][v2] = dist;
                if (!(v2 in edges)) {
                    edges[v2] = {};
                }
                edges[v2][v1] = dist;

                if (max_vertex_id < v1) {
                    max_vertex_id = v1;
                }
                if (max_vertex_id < v2) {
                    max_vertex_id = v2;
                }
            }
        }

        //finally, add edge from start point to start station (all lines)
        var start_point_vertex_id = max_vertex_id + 1;
        var edges_from_start_point = {};
        var start_station = this.map_data.stations[start_station_id];
        for (var station_vertex_idx = 0; station_vertex_idx < start_station.vertices.length; station_vertex_idx++) {
            edges_from_start_point[start_station.vertices[station_vertex_idx]] = 0;
        }
        edges[start_point_vertex_id] = edges_from_start_point;

        return { edges: edges, start_point_vertex_id: start_point_vertex_id };
    }

    _findShortestPath(graph) {
        var edges = graph.edges;
        var min_costs = {};
        var prev_vertices = {};
        var pending_vertices = {};
        var completed_vertices = {};
        for (var vertex_id in edges) {
            min_costs[vertex_id] = Number.POSITIVE_INFINITY;
            prev_vertices[vertex_id] = null;
        }
        min_costs[graph.start_point_vertex_id] = 0;
        pending_vertices[graph.start_point_vertex_id] = true;

        while (true) {
            var min_cost_vertex = null;
            var min_cost_vertex_cost = Number.POSITIVE_INFINITY;
            for (var vertex in pending_vertices) {
                if (!completed_vertices[vertex] && min_costs[vertex] < min_cost_vertex_cost) {
                    min_cost_vertex = vertex;
                    min_cost_vertex_cost = min_costs[vertex];
                }
            }

            if (min_cost_vertex == null) {
                break;
            }

            for (var to_vertex in edges[min_cost_vertex]) {
                pending_vertices[to_vertex] = true;
                var to_cost = min_cost_vertex_cost + edges[min_cost_vertex][to_vertex];
                if (to_cost < min_costs[to_vertex]) {
                    min_costs[to_vertex] = to_cost;
                    prev_vertices[to_vertex] = min_cost_vertex;
                }
            }

            completed_vertices[min_cost_vertex] = true;
        }

        return { min_costs: min_costs, prev_vertices: prev_vertices };
    }

    _distanceForEachStation(shortest_path) {
        // from cost to each vertices, find lowest cost to each station

        //for each station, find lowest cost vertex
        var station_cost = [];//station_id: cost
        for (var station_id = 0; station_id < this.map_data.stations.length; station_id++) {
            var station = this.map_data.stations[station_id];
            var lowest_cost = Number.POSITIVE_INFINITY;
            for (var vertex_idx_station = 0; vertex_idx_station < station.vertices.length; vertex_idx_station++) {
                var vertex_id = station.vertices[vertex_idx_station];
                if (shortest_path.min_costs[vertex_id] < lowest_cost) {
                    lowest_cost = shortest_path.min_costs[vertex_id];
                }
            }

            station_cost[station_id] = lowest_cost;
        }

        return station_cost;
    }


}

var map_data = null;
window.map_data_callback = function (json: any) {
    map_data = json;
}
$(function () {
    setTimeout(init_map, 1);
});

var calc_time = null;
var svg_id_to_station_id = {};
var station_id_to_svg_obj = {};
var station_id_to_svg_box_obj = {};
var vertex_stations = {};
var line_edge_id_to_svg_obj = {};//key: "line_id,edge_idx"
var time_circle_svg_obj = {};//key: minute from center
var center_station_id = 0;
var px_per_minute = 10;
var init_map = function () {
    if (map_data === null) {
        //wait until map is loaded
        setTimeout(init_map, 1);
        return;
    }

    calc_time = new CalcTime(map_data);

    //for (var i = 0; i < station_cost.length; i++) {
    //    $("#content").append("<span>" + calc_time.map_data.stations[i].station_name + ": " + station_cost[i] + "</span><br />");
    //}

    //svg線路・駅オブジェクトを生成

    var paper = Snap("#mainmap");
    var center_station_pos = [map_data.stations[center_station_id].longitude, map_data.stations[center_station_id].latitude];
    var calc_station_pos = function (station) {
        var longi_diff = station.longitude - center_station_pos[0];
        var lati_diff = station.latitude - center_station_pos[1];
        var geo_dist = Math.sqrt(Math.pow(longi_diff, 2) + Math.pow(lati_diff, 2));
        if (geo_dist > 0) {
            var scale = 3000;//by physical distance
        } else {
            var scale = 0;
        }
        return [longi_diff * scale + 320, lati_diff * -scale + 240];
    }

    //時間同心円描画
    for (var minute = 10; minute <= 60; minute += 10) {
        time_circle_svg_obj[minute] = paper.circle(320, 240, px_per_minute * minute).attr({ fill: 'none', stroke: 'blue', strokeWidth: 5 });
    }

    //拡大ボタン
    paper.text(0, 0, '+').click(function () {
        px_per_minute *= 2;
        update_map();
    });
    paper.text(0, 10, '-').click(function () {
        px_per_minute *= 0.5;
        update_map();
    });

    //線路描画
    for (var i = 0; i < map_data.stations.length; i++) {
        var stations = map_data.stations;
        for (var vertex_idx = 0; vertex_idx < stations[i].vertices.length; vertex_idx++) {
            vertex_stations[stations[i].vertices[vertex_idx]] = stations[i];
        }
    }
    for (var line_id = 0; line_id < map_data.lines.length; line_id++) {
        var line = map_data.lines[line_id];
        var line_color = line.color;
        for (var edge_idx = 0; edge_idx < line.edges.length; edge_idx++) {
            var edge = line.edges[edge_idx];
            //edgeの両端が属する駅の座標を取得
            var v1_station = vertex_stations[edge[0]];
            var v2_station = vertex_stations[edge[1]];
            var v1_station_pos = calc_station_pos(v1_station);
            var v2_station_pos = calc_station_pos(v2_station);
            var svg_edge = paper.line(v1_station_pos[0], v1_station_pos[1], v2_station_pos[0], v2_station_pos[1]).attr({ stroke: line_color, strokeWidth: 3 });
            line_edge_id_to_svg_obj['' + line_id + ',' + edge_idx] = svg_edge;
        }
    }

    //駅名描画
    for (var i = 0; i < map_data.stations.length; i++) {
        var station = map_data.stations[i];
        var station_display_pos = calc_station_pos(station);
        var svg_station_name_box = paper.rect(1, 1, 100, 100).attr({ fill: 'white', stroke: 'black', strokeWidth: '2px' });
        var svg_station_name = paper.text(station_display_pos[0], station_display_pos[1], station.station_name).attr({ textAnchor: "middle", dominantBaseline: "middle", fill: (i == center_station_id ? "red" : "black") });
        var name_rect = svg_station_name.node.getBoundingClientRect();
        svg_station_name_box.attr({ width: name_rect.width, height: name_rect.height, x: station_display_pos[0] - name_rect.width / 2, y: station_display_pos[1] - name_rect.height / 2 });
        svg_id_to_station_id[(<any>svg_station_name).id] = station.station_id;
        station_id_to_svg_obj[String(station.station_id)] = svg_station_name;
        station_id_to_svg_box_obj[String(station.station_id)] = svg_station_name_box;
        svg_station_name.click(function (e) {
            center_station_id = svg_id_to_station_id[this.id];
            update_map();
        });
    }
};

var update_map = function () {
    var station_cost = calc_time.calcTime(center_station_id);

    //svg線路・駅オブジェクトを生成

    var paper = Snap("#mainmap");
    var center_station_pos = [map_data.stations[center_station_id].longitude, map_data.stations[center_station_id].latitude];
    var calc_station_pos = function (station) {
        var longi_diff = station.longitude - center_station_pos[0];
        var lati_diff = station.latitude - center_station_pos[1];
        var geo_dist = Math.sqrt(Math.pow(longi_diff, 2) + Math.pow(lati_diff, 2));
        if (geo_dist > 0) {
            var scale = station_cost[station.station_id] * px_per_minute / geo_dist;//by train time
            //var scale = 3000;//by physical distance
        } else {
            var scale = 0;
        }
        return [longi_diff * scale + 320, lati_diff * -scale + 240];
    }

    for (var line_id = 0; line_id < map_data.lines.length; line_id++) {
        var line = map_data.lines[line_id];
        var line_color = line.color;
        for (var edge_idx = 0; edge_idx < line.edges.length; edge_idx++) {
            var edge = line.edges[edge_idx];
            //edgeの両端が属する駅の座標を取得
            var v1_station = vertex_stations[edge[0]];
            var v2_station = vertex_stations[edge[1]];
            var v1_station_pos = calc_station_pos(v1_station);
            var v2_station_pos = calc_station_pos(v2_station);
            var svg_edge = line_edge_id_to_svg_obj['' + line_id + ',' + edge_idx];
            svg_edge.stop().animate({ x1: v1_station_pos[0], y1: v1_station_pos[1], x2: v2_station_pos[0], y2: v2_station_pos[1] }, 1000);
        }
    }

    //駅位置設定
    for (var i = 0; i < map_data.stations.length; i++) {
        var station = map_data.stations[i];
        var station_display_pos = calc_station_pos(station);
        var svg_station_name = station_id_to_svg_obj[station.station_id];
        var svg_station_name_box = station_id_to_svg_box_obj[station.station_id];
        svg_station_name.attr({ fill: (i == center_station_id ? "red" : "black") });
        svg_station_name.stop().animate({ x: station_display_pos[0], y: station_display_pos[1] }, 1000);
        var name_rect = svg_station_name.node.getBoundingClientRect();
        svg_station_name_box.stop().animate({ x: station_display_pos[0] - name_rect.width / 2, y: station_display_pos[1] - name_rect.height / 2 }, 1000);
    }

    for (var minute in time_circle_svg_obj) {
        time_circle_svg_obj[minute].stop().animate({ r: px_per_minute * Number(minute) }, 1000);
    }
};
