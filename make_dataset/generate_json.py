#!/usr/bin/env python
# -*- coding:utf-8 -*-

"""
CSVファイル等からjavascript用jsonを生成
"""

import json
import csv

def load_lines_csv(path):
    rd = csv.DictReader(open(path, encoding="utf-8"))
    lines = [{"line_id":0, "company_name":"", "line_name":"徒歩連絡", "color":"#000000", "edges":[]}]
    for row in rd:
        lines.append(
            {"line_id":len(lines),
             "company_name":row["会社名"],
             "line_name":row["路線名"],
             "color":row["色(#RGB)"],
             "edges":[]})

    return lines

def load_stations_csv(path, lines):
    rd = csv.DictReader(open(path, encoding="utf-8"))
    line_name_lines = {line["line_name"]:line for line in lines}
    stations = []#{station_id, station_name, latitude, longitude, [vertex_id], priority}
    station_name_stations = {}

    last_line = None
    next_vertex_id = 0
    for row in rd:
        line_name = row["路線名"]
        station_name = row["駅名"]
        station_number = row["駅番号"]
        priority = row["優先度"]
        vertex_id = next_vertex_id
        next_vertex_id += 1

        if last_line != line_name:
            station_number_vertex_id = {}

        station_number_vertex_id[station_number] = vertex_id
        if station_name not in station_name_stations:
            station_id = len(stations)
            new_station = {"station_id":station_id, "station_name":station_name, "vertices":[], "priority": 0}
            stations.append(new_station)
            station_name_stations[station_name] = new_station

        station_name_stations[station_name]["vertices"].append(vertex_id)
        if priority:
            station_name_stations[station_name]["priority"] = int(priority)

        for i_next_station in [1,2,3]:
            next_station_number = row["隣接駅番号" + str(i_next_station)]
            if next_station_number:
                next_station_time = int(row["所要時間" + str(i_next_station)])
                line_name_lines[line_name]["edges"].append([vertex_id, station_number_vertex_id[next_station_number], next_station_time])

        last_line = line_name

    return stations

def load_walk_csv(path):
    rd = csv.DictReader(open(path, encoding="utf-8"))
    walk_pairs = []
    for row in rd:
        walk_pairs.append((row["徒歩乗換駅名1"], row["徒歩乗換駅名2"]))

    return walk_pairs

def build_walk_edge(line_walk_edges, stations, walk_pairs):
    """
    「徒歩連絡」線に同名駅の乗り換えおよび異名乗り換え駅のエッジを挿入
    """

    walk_time = 5#一律の徒歩乗り換え時間
    station_name_vertices = {}
    for station in stations:
        station_name_vertices[station["station_name"]] = station["vertices"]
        for i, vi in enumerate(station["vertices"]):
            for vj in station["vertices"][i+1:]:
                line_walk_edges.append([vi, vj, walk_time])

    for walk_pair in walk_pairs:
        for vi in station_name_vertices[walk_pair[0]]:
            for vj in station_name_vertices[walk_pair[1]]:
                line_walk_edges.append([vi, vj, walk_time])

def get_station_location(stations_location_csv, stations, center_pos):
    """
    駅の緯度経度を求める。同名の駅があるので、指定した中心位置に最も近いものを選択する。
    データベースには北端・南端に分かれているが平均をとる。
    """
    center_longi, center_lati = center_pos
    rd = csv.DictReader(open(stations_location_csv, encoding="utf-8"), fieldnames = ["line_name", "company_name", "station_name", "longitude_low", "latitude_low", "longitude_high", "latitude_high"])
    station_name_station = {station["station_name"]:station for station in stations}
    for row in rd:
        station_name = row["station_name"]
        if station_name in station_name_station:
            station = station_name_station[station_name]
            longi_avg = (float(row["longitude_low"]) + float(row["longitude_high"])) / 2.0
            lati_avg = (float(row["latitude_low"]) + float(row["latitude_high"])) / 2.0
            if "latitude" in station:
                #すでに情報があるので、近い場合のみ代入
                diff_existing = abs(station["longitude"] - center_longi) + abs(station["latitude"] - center_lati)
                diff_new = abs(longi_avg - center_longi) + abs(lati_avg - center_lati)
                if diff_existing < diff_new:
                    continue

            station["longitude"] = longi_avg
            station["latitude"] = lati_avg

def main():
    lines = load_lines_csv("lines.csv")
    stations = load_stations_csv("stations.csv", lines)
    walk_pairs = load_walk_csv("walk.csv")
    build_walk_edge(lines[0]["edges"], stations, walk_pairs)
    get_station_location("20141005_stations.csv", stations, [139.76746, 35.67936])
    with open("../dist/map_data.js", "wt") as f:
        f.write("map_data_callback(")
        json.dump({"lines":lines, "stations":stations}, f)
        f.write(");")

if __name__ == '__main__':
    main()

