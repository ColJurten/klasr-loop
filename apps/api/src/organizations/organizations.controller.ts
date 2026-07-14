import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { OrganizationsService } from './organizations.service';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly service: OrganizationsService) {}

  @Post()
  create(@Body() dto: CreateOrganizationDto): Promise<Organization> {
    return this.service.create(dto);
  }

  @Get(':id')
  getById(@Param('id') id: string): Promise<Organization> {
    return this.service.getById(id);
  }
}
