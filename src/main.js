(function (global) {
    var map_data = null;
    global.map_data_callback = function (json) {
        map_data = json;
    };

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

        calc_time = new global.CalcTime(map_data);

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
        for (var minute = 10; minute <= 60; minute+=10) {
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
            var svg_station_name_box = paper.rect(1, 1, 100, 100).attr({fill: 'white', stroke: 'black', strokeWidth: '2px'});
            var svg_station_name = paper.text(station_display_pos[0], station_display_pos[1], station.station_name).attr({ textAnchor: "middle", dominantBaseline: "middle", fill: (i == center_station_id ? "red" : "black") });
            var name_rect = svg_station_name.node.getBoundingClientRect();
            svg_station_name_box.attr({width: name_rect.width, height: name_rect.height, x: station_display_pos[0] - name_rect.width / 2, y: station_display_pos[1] - name_rect.height / 2});
            svg_id_to_station_id[svg_station_name.id] = station.station_id;
            station_id_to_svg_obj[String(station.station_id)] = svg_station_name;
            station_id_to_svg_box_obj[String(station.station_id)] = svg_station_name_box;
            svg_station_name.click(function (e, x, y) {
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
            svg_station_name.stop().animate({ x: station_display_pos[0], y: station_display_pos[1], fill: (i == center_station_id ? "red" : "black") }, 1000);
            var name_rect = svg_station_name.node.getBoundingClientRect();
            svg_station_name_box.stop().animate({ x: station_display_pos[0] - name_rect.width / 2, y: station_display_pos[1] - name_rect.height / 2 }, 1000);
        }

        for (var minute in time_circle_svg_obj) {
            time_circle_svg_obj[minute].stop().animate({ r: px_per_minute * Number(minute) }, 1000);
        }
    };
})(("global", eval)("this"));
