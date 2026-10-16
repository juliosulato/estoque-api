import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ProductImage } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard.js';
import { ConfirmImageDto } from './dto/confirm-image.dto.js';
import { PresignImageDto } from './dto/presign-image.dto.js';
import { ReorderImagesDto } from './dto/reorder-images.dto.js';
import { MediaService, type PresignResult } from './media.service.js';

@UseGuards(AuthGuard)
@Controller('admin/produtos/:id/imagens')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('presign')
  @HttpCode(HttpStatus.OK)
  presign(
    @Param('id') id: string,
    @Body() dto: PresignImageDto,
  ): Promise<PresignResult> {
    return this.mediaService.presign(id, dto);
  }

  @Post()
  confirm(
    @Param('id') id: string,
    @Body() dto: ConfirmImageDto,
  ): Promise<ProductImage> {
    return this.mediaService.confirm(id, dto);
  }

  @Patch('ordem')
  reorder(
    @Param('id') id: string,
    @Body() dto: ReorderImagesDto,
  ): Promise<ProductImage[]> {
    return this.mediaService.reorder(id, dto);
  }

  @Delete(':imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ): Promise<void> {
    return this.mediaService.remove(id, imageId);
  }
}
