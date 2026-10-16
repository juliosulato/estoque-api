import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { s3Provider, S3_CLIENT } from './s3.provider.js';

@Module({
  imports: [AuthModule],
  controllers: [MediaController],
  providers: [MediaService, s3Provider],
  exports: [S3_CLIENT],
})
export class MediaModule {}
