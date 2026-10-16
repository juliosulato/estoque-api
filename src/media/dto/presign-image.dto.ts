import { IsIn, IsInt, Min } from 'class-validator';

export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const;

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export class PresignImageDto {
  @IsIn(ALLOWED_IMAGE_TYPES)
  contentType!: AllowedImageType;

  @IsInt()
  @Min(1)
  size!: number;
}
