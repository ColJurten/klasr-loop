import { IsOptional, IsString, Matches } from 'class-validator';

export class ConfirmProposalDto {
  /** Present only when the user overrides the proposed destination ("Déplacer"). */
  @IsOptional()
  @IsString()
  @Matches(/^\//)
  overrideDestinationPath?: string;
}
