#!/bin/sh
# get geography data of stations

set -e
set -x

wget http://parosky.net/static/data/20141005_stations.csv.zip
unzip 20141005_stations.csv.zip
