#!/bin/bash
if [ -d openrelik ]; then
  cd openrelik
  docker compose up
else
  rm -rf install.sh
  curl -s -O https://raw.githubusercontent.com/openrelik/openrelik-deploy/main/docker/install.sh
  bash install.sh
fi