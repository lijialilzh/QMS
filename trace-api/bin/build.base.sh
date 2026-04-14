#!/bin/bash

set -e

current_dir=$(cd `dirname $0`; pwd)
project_dir=$(dirname $current_dir)
cd $current_dir

push_flag=${1-0}
image_url=hub.infervision.com/dev/doc-trace/trace-api.base

image_version=$(git branch -v|grep '^*'|awk '{print $2}').$(date "+%y%m%d%H%M").$(git rev-parse --short HEAD)
image_tag=$image_url:$image_version
docker build --force-rm -t $image_tag -f $current_dir/Dockerfile.base.txt $project_dir
[[ $push_flag == 1 ]] && docker push $image_tag
