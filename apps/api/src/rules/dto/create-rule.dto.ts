import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { ConditionField, ConditionOperator } from '@prisma/client';

export class RuleConditionDto {
  @IsEnum(ConditionField)
  field!: ConditionField;

  @IsEnum(ConditionOperator)
  operator!: ConditionOperator;

  @IsString()
  @IsNotEmpty()
  value!: string;
}

export class CreateRuleDto {
  @IsInt()
  @Min(1)
  priority!: number;

  @IsString()
  @Matches(/^\//, { message: 'destinationPath must be an absolute path like /Comptabilité/Factures' })
  destinationPath!: string;

  @IsOptional()
  @IsString()
  suggestedNameTemplate?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RuleConditionDto)
  conditions!: RuleConditionDto[];
}
