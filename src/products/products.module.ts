import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MediaModule } from '../media/media.module.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
