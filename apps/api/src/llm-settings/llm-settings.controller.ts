import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard';
import { LlmSettingDto } from './dto/llm-setting.dto';
import { LlmSettingsService } from './llm-settings.service';

@Controller('organizations/:organizationId/llm-settings')
@UseGuards(InternalServiceGuard)
export class LlmSettingsController {
  constructor(private readonly settings: LlmSettingsService) {}
  @Get() get(@Param('organizationId') organizationId: string) { return this.settings.get(organizationId); }
  @Post('models') discover(@Body() input: LlmSettingDto) { return this.settings.discover(input); }
  @Put() save(@Param('organizationId') organizationId: string, @Body() input: LlmSettingDto) { return this.settings.save(organizationId, input); }
  @Delete() remove(@Param('organizationId') organizationId: string) { return this.settings.remove(organizationId); }
}
