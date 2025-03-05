#!/bin/bash
echo 'include:' > docker-compose.yml.new
for f in ../*/compose-include.yml; do
  echo "  - $f" >> docker-compose.yml.new
done
cat docker-compose.yml.orig >> docker-compose.yml.new
mv docker-compose.yml.new docker-compose.yml