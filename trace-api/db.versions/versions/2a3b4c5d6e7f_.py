"""add cybersec_plan_doc table

Revision ID: 2a3b4c5d6e7f
Revises: 93937f884e97
Create Date: 2026-08-05 11:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2a3b4c5d6e7f'
down_revision: Union[str, None] = '93937f884e97'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('cybersec_plan_doc',
        sa.Column('product_id', sa.Integer(), nullable=False, comment='产品ID'),
        sa.Column('version', sa.String(length=64), nullable=False, comment='文档版本'),
        sa.Column('file_no', sa.String(length=128), nullable=True, comment='文件编号'),
        sa.Column('change_log', sa.String(length=512), nullable=True, comment='版本变更说明'),
        sa.Column('content', sa.JSON(), nullable=True, comment='文档内容'),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('create_time', sa.DateTime(), nullable=True),
        sa.Column('update_time', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('product_id', 'version', name='uq_cybersec_plan_doc_product_version'),
    )
    op.create_index('ix_cybersec_plan_doc_product_id', 'cybersec_plan_doc', ['product_id'])


def downgrade() -> None:
    op.drop_index('ix_cybersec_plan_doc_product_id', table_name='cybersec_plan_doc')
    op.drop_table('cybersec_plan_doc')
