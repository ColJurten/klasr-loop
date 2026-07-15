import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';
import { DriveProvider } from '@prisma/client';

export class RootFolderDto {
  @IsString()
  @IsNotEmpty()
  externalId!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;
}

/**
 * Payload posted by the web app after an org admin completes the Drive OAuth
 * grant + Picker folder selection. `organizationId` is trusted here because
 * the web layer already sourced it from the server-side session, never from
 * client input (see apps/web/app/api/drive/finalize/route.ts).
 */
export class ConnectDriveDto {
  @IsString()
  @IsNotEmpty()
  organizationId!: string;

  @IsIn(['GOOGLE_DRIVE', 'ONEDRIVE'])
  provider!: DriveProvider;

  @IsString()
  @IsNotEmpty()
  externalId!: string;

  @IsString()
  @IsNotEmpty()
  refreshToken!: string;

  @IsArray()
  @IsString({ each: true })
  scopes!: string[];

  @ValidateNested()
  @Type(() => RootFolderDto)
  rootFolder!: RootFolderDto;
}
