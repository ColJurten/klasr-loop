import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TokenEncryptionService } from '../auth/token-encryption.service';
import { DriveConnectionsRepository } from './drive-connections.repository';

@Injectable()
export class GoogleTokenService {
  constructor(
    private readonly connections: DriveConnectionsRepository,
    private readonly tokens: TokenEncryptionService,
    private readonly config: ConfigService,
  ) {}

  async getAccessToken(organizationId: string): Promise<string> {
    const connection = await this.connections.findByOrganization(organizationId);
    if (!connection || connection.provider !== 'GOOGLE_DRIVE') {
      throw new UnauthorizedException('Google Drive is not connected');
    }
    const refreshToken = this.tokens.decrypt(connection.encryptedToken);
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.get<string>('GOOGLE_CLIENT_ID') ?? '',
        client_secret: this.config.get<string>('GOOGLE_CLIENT_SECRET') ?? '',
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!response.ok) throw new UnauthorizedException('Google token refresh failed');
    const payload = (await response.json()) as { access_token?: string };
    if (!payload.access_token) throw new UnauthorizedException('Google token refresh failed');
    return payload.access_token;
  }
}
