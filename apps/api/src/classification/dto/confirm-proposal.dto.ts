import { IsOptional, IsString, Matches } from 'class-validator';

export class ConfirmProposalDto {
  /** Backward-compatible path override; new UI sends destinationFolderExternalId. */
  @IsOptional()
  @IsString()
  @Matches(/^\//)
  overrideDestinationPath?: string;

  @IsOptional()
  @IsString()
  destinationFolderExternalId?: string;

  @IsOptional()
  @IsString()
  finalName?: string;
}
