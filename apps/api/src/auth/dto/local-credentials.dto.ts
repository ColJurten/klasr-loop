import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LocalCredentialsDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}

export class RegisterLocalDto extends LocalCredentialsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName!: string;
}

export class EnrollLocalPasswordDto {
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}
