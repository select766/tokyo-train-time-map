(function (global) {
    CalcTime = function (map_data) {
        this.map_data = map_data;
    }

    CalcTime.prototype.calcTime = function (start_station_id) {
        //calculate time to each station from the station
        var graph = this._createEdges(start_station_id);
        var shortest_path = this._findShortestPath(graph);
        var station_cost = this._distanceForEachStation(shortest_path);
        return station_cost;
    }

    CalcTime.prototype._createEdges = function (start_station_id) {
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

        return {edges: edges, start_point_vertex_id: start_point_vertex_id};
    }

    CalcTime.prototype._findShortestPath = function (graph) {
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

        return { min_costs: min_costs,prev_vertices:prev_vertices };
    }

    CalcTime.prototype._distanceForEachStation = function (shortest_path) {
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

    global.CalcTime = CalcTime;
})(("global", eval)("this"));
