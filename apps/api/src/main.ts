import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api');

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
  app.enableCors({
    origin: isProd
      ? appUrl
      : (
          origin: string | undefined,
          cb: (err: Error | null, allow?: boolean) => void,
        ) => {
          if (!origin) return cb(null, true);
          if (localDevOrigin.test(origin) || origin === appUrl) return cb(null, true);
          cb(null, false);
        },
    credentials: true,
  });

  const port = process.env.API_PORT || 3001;
  await app.listen(port);
  logger.log(`API running on http://localhost:${port}`);
}

bootstrap();
