import { Injectable } from '@nestjs/common';
import { MenuItem } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';

@Injectable()
export class MenuRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAllAvailable(): Promise<MenuItem[]> {
    return this.prisma.menuItem.findMany({
      where: { available: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  findById(id: string): Promise<MenuItem | null> {
    return this.prisma.menuItem.findUnique({ where: { id } });
  }

  create(data: CreateMenuItemDto): Promise<MenuItem> {
    return this.prisma.menuItem.create({ data });
  }

  update(id: string, data: UpdateMenuItemDto): Promise<MenuItem> {
    return this.prisma.menuItem.update({ where: { id }, data });
  }

  softDelete(id: string): Promise<MenuItem> {
    return this.prisma.menuItem.update({
      where: { id },
      data: { available: false },
    });
  }
}
