from sqlalchemy import select
from db.models import ClassificationRule, RuleCondition
from repositories.serialization import serialize


class RulesRepository:
    def __init__(self, session):
        self.session = session

    def view(self, row):
        conditions = self.session.scalars(
            select(RuleCondition)
            .join(ClassificationRule, RuleCondition.rule_id == ClassificationRule.id)
            .where(
                ClassificationRule.organization_id == row.organization_id,
                RuleCondition.rule_id == row.id,
            )
        ).all()
        return {**serialize(row), "conditions": serialize(list(conditions))}

    def list(self, organization_id):
        return [
            self.view(row)
            for row in self.session.scalars(
                select(ClassificationRule)
                .where(
                    ClassificationRule.organization_id == organization_id,
                    ClassificationRule.enabled.is_(True),
                )
                .order_by(ClassificationRule.priority)
            )
        ]

    def exists(self, organization_id, priority):
        return (
            self.session.scalar(
                select(ClassificationRule.id).where(
                    ClassificationRule.organization_id == organization_id,
                    ClassificationRule.priority == priority,
                )
            )
            is not None
        )

    def create(self, organization_id, dto):
        with self.session.begin_nested():
            row = ClassificationRule(
                organization_id=organization_id,
                priority=dto.priority,
                destination_path=dto.destinationPath,
                suggested_name_template=dto.suggestedNameTemplate,
            )
            self.session.add(row)
            self.session.flush()
            self.session.add_all(
                [
                    RuleCondition(rule_id=row.id, **condition.model_dump())
                    for condition in dto.conditions
                ]
            )
            self.session.flush()
        return self.view(row)
