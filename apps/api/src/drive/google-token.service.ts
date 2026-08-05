import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sign } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { readFileSync } from 'node:fs';
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
    if (process.env.KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT === 'true') {
      return this.getServiceAccountAccessToken();
    }
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

  private async getServiceAccountAccessToken(): Promise<string> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT cannot run in production');
    }
    const path = process.env.KLASR_GOOGLE_SERVICE_ACCOUNT_FILE;
    if (!path || !isAbsolute(path)) throw new Error('KLASR_GOOGLE_SERVICE_ACCOUNT_FILE must be an absolute path');
    let credential: { type?: string; client_email?: string; private_key?: string; token_uri?: string };
    try {
      credential = JSON.parse(this.readCredential(path)) as typeof credential;
    } catch {
      throw new Error('Google service-account credential is not valid JSON');
    }
    if (credential.type !== 'service_account' || !credential.client_email || !credential.private_key || !credential.token_uri) {
      throw new Error('Google service-account credential is missing required fields');
    }
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
      iss: credential.client_email,
      scope: 'https://www.googleapis.com/auth/drive',
      aud: credential.token_uri,
      iat: now,
      exp: now + 3600,
    })}`;
    const assertion = `${unsigned}.${this.signAssertion(unsigned, credential.private_key)}`;
    const response = await fetch(credential.token_uri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!response.ok) throw new UnauthorizedException('Google service-account token exchange failed');
    const payload = (await response.json()) as { access_token?: string };
    if (!payload.access_token) throw new UnauthorizedException('Google service-account token exchange failed');
    return payload.access_token;
  }

  private readCredential(path: string): string {
    return readFileSync(path, 'utf8');
  }

  private signAssertion(input: string, key: string): string {
    return sign('RSA-SHA256', Buffer.from(input), key).toString('base64url');
  }
}
