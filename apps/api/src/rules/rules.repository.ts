import { Injectable } from '@nestjs/common';
import { ClassificationRule, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type RuleWithConditions = Prisma.ClassificationRuleGetPayload<{
  include: { conditions: true };
}>;

@Injectable()
export class RulesRepository {
  constructor(private readonly prisma: PrismaService) {}

  listOrdered(organizationId: string): Promise<RuleWithConditions[]> {
    return this.prisma.classificationRule.findMany({
      where: { organizationId, enabled: true },
      orderBy: { priority: 'asc' },
      include: { conditions: true },
    });
  }

  existsAtPriority(organizationId: string, priority: number): Promise<ClassificationRule | null> {
    return this.prisma.classificationRule.findFirst({ where: { organizationId, priority } });
  }

  create(
    organizationId: string,
    data: Omit<Prisma.ClassificationRuleCreateInput, 'organization' | 'conditions'>,
    conditions: Prisma.RuleConditionCreateWithoutRuleInput[],
  ): Promise<RuleWithConditions> {
    return this.prisma.classificationRule.create({
      data: {
        ...data,
        organization: { connect: { id: organizationId } },
        conditions: { create: conditions },
      },
      include: { conditions: true },
    });
  }
}
