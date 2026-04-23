import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/**
 * Requires `DEMO_ADMIN_TOKEN` to be set in the environment, and the same value
 * in either header `X-Demo-Admin-Token` or `Authorization: Bearer <token>`.
 * Used for destructive / sensitive demo admin routes (reset, WhatsApp rebind).
 */
@Injectable()
export class DemoAdminTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('DEMO_ADMIN_TOKEN')?.trim();
    if (!expected) {
      throw new UnauthorizedException(
        'DEMO_ADMIN_TOKEN is not set; demo admin endpoints (reset, rebind-whatsapp) are disabled',
      );
    }
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers['x-demo-admin-token'];
    const auth = req.headers.authorization;
    const token =
      typeof header === 'string' && header.trim()
        ? header.trim()
        : auth?.startsWith('Bearer ')
          ? auth.slice(7).trim()
          : '';
    if (token !== expected) {
      throw new UnauthorizedException('Invalid or missing demo admin token');
    }
    return true;
  }
}
