#!/bin/bash

cd /usr/local/openresty/nginx
envsubst < conf/nginx.server.temp > conf/nginx.server.conf
envsubst < html/trace/env.temp.json > html/trace/env.json

openresty -g 'daemon off;'
