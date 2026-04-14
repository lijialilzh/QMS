#!/bin/bash

set -e

mkdir -p logs
rm -rf db.versions && alembic init db.versions > logs/alembic.log 2>&1
sed -i "s#sqlalchemy.url.*#sqlalchemy.url = $DB_URL #" alembic.ini
cp alembic.env.py db.versions/env.py
alembic -c alembic.ini revision --autogenerate >> logs/alembic.log 2>&1
alembic -c alembic.ini upgrade head >> logs/alembic.log 2>&1

python main_init.py
python main_app.py
