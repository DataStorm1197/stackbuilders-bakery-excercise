import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { MenuService } from './menu.service';

@ApiTags('menu')
@UseGuards(RolesGuard)
@Controller('menu')
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List menu items grouped by category' })
  @ApiResponse({ status: 200, description: 'Menu grouped by category' })
  getMenu() {
    return this.menuService.getMenuGroupedByCategory();
  }

  @Roles(Role.STORE_MANAGER)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new menu item (STORE_MANAGER)' })
  @ApiResponse({ status: 201, description: 'Menu item created' })
  @ApiResponse({ status: 403, description: 'Forbidden — STORE_MANAGER role required' })
  create(@Body() dto: CreateMenuItemDto) {
    return this.menuService.create(dto);
  }

  @Roles(Role.STORE_MANAGER)
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a menu item (STORE_MANAGER)' })
  @ApiResponse({ status: 200, description: 'Menu item updated' })
  @ApiResponse({ status: 404, description: 'Menu item not found' })
  @ApiResponse({ status: 403, description: 'Forbidden — STORE_MANAGER role required' })
  update(@Param('id') id: string, @Body() dto: UpdateMenuItemDto) {
    return this.menuService.update(id, dto);
  }

  @Roles(Role.STORE_MANAGER)
  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a menu item (STORE_MANAGER)' })
  @ApiResponse({ status: 200, description: 'Menu item removed' })
  @ApiResponse({ status: 404, description: 'Menu item not found' })
  @ApiResponse({ status: 403, description: 'Forbidden — STORE_MANAGER role required' })
  remove(@Param('id') id: string) {
    return this.menuService.remove(id);
  }
}
