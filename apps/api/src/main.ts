// rebuild-20260412160911
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api', { exclude: ['whatsapp/webhook'] });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  // Browser treats localhost vs 127.0.0.1 as different origins; dev often uses varying ports.
  const isProd = process.env.NODE_ENV === 'production';
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const localDevOrigin =
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
  const extraCorsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const allowOrigin = (origin: string | undefined): boolean => {
    if (!origin) return true;
    if (extraCorsOrigins.includes(origin)) return true;
    if (origin === appUrl) return true;
    if (!isProd && localDevOrigin.test(origin)) return true;
    return false;
  };

  app.enableCors({
    origin: (
      origin: string | undefined,
      cb: (err: Error | null, allow?: boolean) => void,
    ) => {
      cb(null, allowOrigin(origin));
    },
    credentials: true,
  });

  const port = process.env.API_PORT || 3001;
  await app.listen(port);
  logger.log(`API running on http://localhost:${port}`);
}

bootstrap();
