#!/bin/bash
git clone https://github.com/openrelik/openrelik-worker-template.git
mv openrelik-worker-template ${WORKER}
#sed "s/openrelik-worker-template/${WORKER}/g" develop-watch.yml > develop-watch.sed
cd ${WORKER}/src
sed "s/openrelik-worker-TEMPLATEWORKERNAME/${WORKER}/g" tasks.py > tasks.py2
sed 's#<REPLACE_WITH_COMMAND>#/usr/bin/ls#g' tasks.py2 > tasks.py
rm tasks.py2
cd -