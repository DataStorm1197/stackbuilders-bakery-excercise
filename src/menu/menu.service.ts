import { Injectable, NotFoundException } from '@nestjs/common';
import { Category, MenuItem } from '@prisma/client';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { MenuRepository } from './menu.repository';

type MenuItemResponse = Omit<MenuItem, 'price'> & { price: number };

@Injectable()
export class MenuService {
  constructor(private readonly menuRepository: MenuRepository) {}

  async getMenuGroupedByCategory(): Promise<Partial<Record<Category, MenuItemResponse[]>>> {
    const items = await this.menuRepository.findAllAvailable();
    return items.reduce(
      (acc, item) => {
        const cat = item.category;
        if (!acc[cat]) acc[cat] = [];
        acc[cat]!.push(this.toResponse(item));
        return acc;
      },
      {} as Partial<Record<Category, MenuItemResponse[]>>,
    );
  }

  async create(dto: CreateMenuItemDto): Promise<MenuItemResponse> {
    const item = await this.menuRepository.create(dto);
    return this.toResponse(item);
  }

  async update(id: string, dto: UpdateMenuItemDto): Promise<MenuItemResponse> {
    await this.ensureExists(id);
    const item = await this.menuRepository.update(id, dto);
    return this.toResponse(item);
  }

  async remove(id: string): Promise<MenuItemResponse> {
    await this.ensureExists(id);
    const item = await this.menuRepository.softDelete(id);
    return this.toResponse(item);
  }

  private toResponse(item: MenuItem): MenuItemResponse {
    return { ...item, price: Number(item.price) };
  }

  private async ensureExists(id: string): Promise<void> {
    const item = await this.menuRepository.findById(id);
    if (!item) throw new NotFoundException(`MenuItem ${id} not found`);
  }
}
