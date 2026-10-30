#!/bin/sh
# sheet.sh <video> <out.png> [fps] [cols] : contact sheet of a clip (scaled frames)
ffmpeg -y -loglevel error -i "$1" -vf "fps=${3:-2},scale=260:-1,tile=${4:-8}x${5:-3}:padding=4:color=white" -frames:v 1 "$2"
