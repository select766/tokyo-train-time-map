import * as $ from 'jquery';
import * as Snap from 'snapsvg';

declare global {
    interface Window {
        map_data_callback: any;
    }
}

interface LineData {
    color: string,
    company_name: string,
    edges: number[][],
    line_id: number,
    line_name: string
}

interface StationData {
    latitude: number,
    longitude: number,
    station_id: number,
    station_name: string,
    vertices: number[],
    priority: number
}

interface MapData {
    lines: LineData[],
    stations: StationData[]
}

class CalcTime {
    constructor(private map_data: MapData) {
    }

    // 中心駅から各駅の所要時間[分]を算出する
    calcTime(start_station_id: number): number[] {
        //calculate time to each station from the station
        var graph = this._createEdges(start_station_id);
        var shortest_path = this._findShortestPath(graph);
        var station_cost = this._distanceForEachStation(shortest_path);
        return station_cost;
    }

    _createEdges(start_station_id: number) {
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

    _distanceForEachStation(shortest_path): number[] {
        // from cost to each vertices, find lowest cost to each station

        //for each station, find lowest cost vertex
        var station_cost: number[] = [];//station_id: cost
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

var map_data: MapData;
var map_visualizer: MapVisualizer;
window.map_data_callback = function (json: MapData) {
    map_data = json;
}

function update_transform() {
    map_visualizer.content_svg_group.transform('translate(' + map_offset_x + ',' + map_offset_y + ')');
}

function fit_window_size() {
    let svg = document.getElementById('mainmap');
    svg.setAttribute('height', '' + (window.innerHeight - 180));
    svg.setAttribute('width', '' + (window.innerWidth - 50));
}

function move_center_station_to_window_center() {
    map_offset_x = (window.innerWidth -50) / 2;
    map_offset_y = (window.innerHeight - 180) / 2;
}

$(function () {
    var init_visualizer = function () {
        if (!map_data) {
            //wait until map is loaded
            setTimeout(init_visualizer, 1);
            return;
        }
        map_visualizer = new MapVisualizer(map_data);
        fit_window_size();
    }
    setTimeout(init_visualizer, 1);
});

window.addEventListener('resize', fit_window_size);

let dragging = false;
let drag_origin_x = 0;
let drag_origin_y = 0;
let map_offset_x = (window.innerWidth - 50) / 2;
let map_offset_y = (window.innerHeight - 180) / 2;

document.addEventListener('mouseup', function (e) {
    dragging = false;
});

document.addEventListener('mousemove', function (e) {
    if (dragging) {
        let move_x = e.clientX - drag_origin_x;
        let move_y = e.clientY - drag_origin_y;
        drag_origin_x = e.clientX;
        drag_origin_y = e.clientY;
        map_offset_x += move_x;
        map_offset_y += move_y;
        update_transform();
    }
})

class MapVisualizer {
    calc_time: CalcTime;

    station_id_to_svg_obj = {};
    station_id_to_svg_box_obj = {};
    station_id_to_svg_minibox_obj = {};
    vertex_stations = {};
    line_edge_id_to_svg_obj = {};//key: "line_id,edge_idx"
    time_circle_svg_obj = {};//key: minute from center
    station_id_to_bbox_size: { [key: number]: { width: number, height: number } } = {};
    center_station_id = 0;
    station_cost: number[];
    px_per_minute = 20;
    station_name_size = 15;
    station_pos: { [key: number]: { x: number, y: number, hide: boolean } };
    station_pos_update_needed: boolean = true;
    content_svg_group: Snap.Paper;
    zoomer_svg_group: Snap.Paper;

    constructor(private map_data: MapData) {
        this.calc_time = new CalcTime(map_data);

        this.create_svg_objects();
        this.update_station_name_size(15);
        this.set_center_station(0);
        this.update_map();
    }

    create_svg_objects() {
        //svg線路・駅オブジェクトを生成
        var paper_root = Snap("#mainmap");
        //Chrome, IE
        paper_root.node.addEventListener('mousewheel', (e) => {
            let new_scale = 1.0;
            if (e.deltaY > 0) {
                new_scale = this.px_per_minute * 0.5;
            } else {
                new_scale = this.px_per_minute * 2.0;
            }
            this.update_scale(new_scale);
            this.update_map();
        });

        //Firefox
        paper_root.node.addEventListener('DOMMouseScroll', (e) => {
            let new_scale = 1.0;
            if ((<any>e).detail > 0) {
                new_scale = this.px_per_minute * 0.5;
            } else {
                new_scale = this.px_per_minute * 2.0;
            }
            this.update_scale(new_scale);
            this.update_map();
        });

        //ドラッグ用背景
        let bg = paper_root.rect(0, 0, 10000, 10000).attr({ 'fill': 'white' });
        bg.node.addEventListener('mousedown', function (e) {
            e.preventDefault();
            drag_origin_x = e.clientX;
            drag_origin_y = e.clientY;
            dragging = true;
        });

        let paper = paper_root.group();
        this.content_svg_group = paper;
        this.content_svg_group.transform('translate(' + map_offset_x + ',' + map_offset_y + ')');

        //時間同心円描画
        for (var minute = 10; minute <= 60; minute += 10) {
            this.time_circle_svg_obj[minute] = paper.circle(0, 0, this.px_per_minute * minute).attr({ fill: 'none', stroke: 'gray', strokeWidth: 5, 'stroke-dasharray': 15 });
        }

        //線路描画
        for (var i = 0; i < map_data.stations.length; i++) {
            var stations = map_data.stations;
            for (var vertex_idx = 0; vertex_idx < stations[i].vertices.length; vertex_idx++) {
                this.vertex_stations[stations[i].vertices[vertex_idx]] = stations[i];
            }
        }
        for (var line_id = 0; line_id < map_data.lines.length; line_id++) {
            var line = map_data.lines[line_id];
            var line_color = line.color;
            for (var edge_idx = 0; edge_idx < line.edges.length; edge_idx++) {
                var edge = line.edges[edge_idx];
                var svg_edge = paper.line(0, 0, 0, 0).attr({ stroke: line_color, strokeWidth: 3 });
                this.line_edge_id_to_svg_obj['' + line_id + ',' + edge_idx] = svg_edge;
            }
        }

        //駅名描画
        //Zオーダの都合で、先に円だけ描画
        for (var i = 0; i < map_data.stations.length; i++) {
            var station = map_data.stations[i];
            var svg_station_name_minibox = paper.circle(1, 1, 10).attr({ fill: 'white', stroke: 'black', strokeWidth: '2px', title: station.station_name });
            this.station_id_to_svg_minibox_obj[String(station.station_id)] = svg_station_name_minibox;
            let _this_cap = this;
            (function (_station_id) {
                svg_station_name_minibox.dblclick(function (e) {
                    _this_cap.set_center_station(_station_id);
                    move_center_station_to_window_center();
                    update_transform();
                    _this_cap.update_map();
                });
            })(station.station_id);
        }
        for (var i = 0; i < map_data.stations.length; i++) {
            var station = map_data.stations[i];
            var svg_station_name_box = paper.rect(1, 1, 100, 100).attr({ fill: 'white', stroke: 'black', strokeWidth: '2px' });
            var svg_station_name = paper.text(0, 0, station.station_name).attr({ textAnchor: "middle", dominantBaseline: "middle", fill: (i == this.center_station_id ? "red" : "black") });
            this.station_id_to_svg_obj[String(station.station_id)] = svg_station_name;
            this.station_id_to_svg_box_obj[String(station.station_id)] = svg_station_name_box;
            let _this_cap = this;
            (function (_station_id) {
                svg_station_name.dblclick(function (e) {
                    _this_cap.set_center_station(_station_id);
                    move_center_station_to_window_center();
                    update_transform();
                    _this_cap.update_map();
                });
                svg_station_name_box.dblclick(function (e) {
                    _this_cap.set_center_station(_station_id);
                    move_center_station_to_window_center();
                    update_transform();
                    _this_cap.update_map();
                });
            })(station.station_id);
        }

        //拡大ボタン
        let zoomer_svg_group = paper_root.group();
        this.zoomer_svg_group = zoomer_svg_group;
        let zoomer_rect_attr = { fill: 'white', stroke: 'black', strokeWidth: '2px' };
        let zoomer_text_attr = { textAnchor: "middle", dominantBaseline: "middle" };
        let zoom_button_handler = () => {
            this.update_scale(this.px_per_minute * 2);
            this.update_map();
        };
        let unzoom_button_handler = () => {
            this.update_scale(this.px_per_minute * 0.5);
            this.update_map();
        };
        let large_botton_handler = () => {
            this.update_station_name_size(this.station_name_size + 5);
            this.update_map();
        };
        let small_button_handler = () => {
            this.update_station_name_size(Math.max(this.station_name_size - 5, 5));
            this.update_map();
        };
        zoomer_svg_group.rect(0, 0, 32, 32).attr(zoomer_rect_attr).click(zoom_button_handler);
        zoomer_svg_group.rect(0, 40, 32, 32).attr(zoomer_rect_attr).click(unzoom_button_handler);
        zoomer_svg_group.text(16, 16, '＋').attr(zoomer_text_attr).click(zoom_button_handler);
        zoomer_svg_group.text(16, 56, '－').attr(zoomer_text_attr).click(unzoom_button_handler);
        zoomer_svg_group.rect(40, 0, 32, 32).attr(zoomer_rect_attr).click(large_botton_handler);
        zoomer_svg_group.rect(40, 40, 32, 32).attr(zoomer_rect_attr).click(small_button_handler);
        zoomer_svg_group.text(56, 16, '大').attr(zoomer_text_attr).click(large_botton_handler);
        zoomer_svg_group.text(56, 56, '小').attr(zoomer_text_attr).click(small_button_handler);
        zoomer_svg_group.text(80, 16, 'https://github.com/select766/tokyo-train-time-map').attr({fontSize: 8});
    }

    update_scale(px_per_minute) {
        this.px_per_minute = px_per_minute;
        this.station_pos_update_needed = true;
    }

    set_center_station(center_station_id: number) {
        this.center_station_id = center_station_id;
        this.station_cost = this.calc_time.calcTime(this.center_station_id);
        this.station_pos_update_needed = true;
    }

    update_station_name_size(size: number) {
        this.station_name_size = size;
        for (var i = 0; i < map_data.stations.length; i++) {
            let svg_station_name = this.station_id_to_svg_obj[i];
            let svg_station_name_box = this.station_id_to_svg_box_obj[i];
            let svg_station_name_minibox = this.station_id_to_svg_minibox_obj[i];
            svg_station_name.attr({ 'font-size': size, display: 'inline' });
            var name_rect = svg_station_name.node.getBoundingClientRect();
            this.station_id_to_bbox_size[i] = { width: name_rect.width, height: name_rect.height };
            svg_station_name_minibox.attr({ r: name_rect.height / 4 });
            svg_station_name_box.attr({ width: name_rect.width, height: name_rect.height, x: 0, y: 0 });
        }
        this.station_pos_update_needed = true;
    }

    update_map() {
        if (this.station_pos_update_needed) {
            this.station_pos = this.calc_station_pos();
            this.station_pos_update_needed = false;
        }
        let station_pos = this.station_pos;

        for (var line_id = 0; line_id < map_data.lines.length; line_id++) {
            var line = map_data.lines[line_id];
            var line_color = line.color;
            for (var edge_idx = 0; edge_idx < line.edges.length; edge_idx++) {
                var edge = line.edges[edge_idx];
                //edgeの両端が属する駅の座標を取得
                var v1_station = this.vertex_stations[edge[0]];
                var v2_station = this.vertex_stations[edge[1]];
                var v1_station_pos = station_pos[v1_station.station_id];
                var v2_station_pos = station_pos[v2_station.station_id];
                var svg_edge = this.line_edge_id_to_svg_obj['' + line_id + ',' + edge_idx];
                svg_edge.stop().animate({ x1: v1_station_pos.x, y1: v1_station_pos.y, x2: v2_station_pos.x, y2: v2_station_pos.y }, 1000);
            }
        }

        //駅位置設定
        for (var i = 0; i < map_data.stations.length; i++) {
            var station = map_data.stations[i];
            var station_display_pos = station_pos[station.station_id];
            var svg_station_name = this.station_id_to_svg_obj[station.station_id];
            var svg_station_name_minibox = this.station_id_to_svg_minibox_obj[station.station_id];
            var svg_station_name_box = this.station_id_to_svg_box_obj[station.station_id];

            svg_station_name.attr({ display: (station_display_pos.hide ? "none" : "inline"), fill: (i == this.center_station_id ? "red" : "black") });
            svg_station_name_box.attr({ display: (station_display_pos.hide ? "none" : "inline") });

            svg_station_name.stop().animate({ x: station_display_pos.x, y: station_display_pos.y }, 1000);
            var name_rect = svg_station_name.node.getBoundingClientRect();
            svg_station_name_box.stop().animate({ x: station_display_pos.x - name_rect.width / 2, y: station_display_pos.y - name_rect.height / 2 }, 1000);
            svg_station_name_minibox.stop().animate({ cx: station_display_pos.x, cy: station_display_pos.y }, 1000);
        }

        for (var minute in this.time_circle_svg_obj) {
            this.time_circle_svg_obj[minute].stop().animate({ r: this.px_per_minute * Number(minute) }, 1000);
        }
    }

    // 駅位置の計算
    // 中心駅が座標0となる
    calc_station_pos(): { [key: number]: { x: number, y: number, hide: boolean } } {
        let positions: { [key: number]: { x: number, y: number, hide: boolean } } = {};
        let center_station = this.map_data.stations[this.center_station_id];
        let existing_boxes: { left: number, right: number, top: number, bottom: number }[] = [];

        let station_priority = this.map_data.stations.map(st => { return [st.station_id, st.station_id == this.center_station_id ? 10 : st.priority] });
        station_priority.sort((a, b) => (b[1] - a[1]));

        for (let i = 0; i < station_priority.length; i++) {
            let station_id = station_priority[i][0];
            let station = this.map_data.stations[station_id];
            let bbox_size = this.station_id_to_bbox_size[station_id];
            let x = 0;
            let y = 0;
            let hide = false;
            if (station_id != this.center_station_id) {
                let longi_diff = station.longitude - center_station.longitude;
                let lati_diff = station.latitude - center_station.latitude;
                let angle = Math.atan2(-lati_diff, longi_diff);//y軸は緯度の減少方向
                let cost = this.station_cost[station_id];
                x = this.px_per_minute * cost * Math.cos(angle);
                y = this.px_per_minute * cost * Math.sin(angle);
            }

            let bbox = {
                left: x - bbox_size.width / 2, right: x + bbox_size.width / 2,
                top: y - bbox_size.height / 2, bottom: y + bbox_size.height / 2
            };

            hide = existing_boxes.some((ebb) => {
                return (Math.min(bbox.right, ebb.right) > Math.max(bbox.left, ebb.left)) &&
                    (Math.min(bbox.bottom, ebb.bottom) > Math.max(bbox.top, ebb.top));
            });

            positions[station_id] = { x: x, y: y, hide: hide };
            if (!hide) {
                existing_boxes.push(bbox);
            }
        }

        return positions;
    }
}
