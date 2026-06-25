import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, UseGuards} from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthUser } from '../auth/strategies/jwt.strategy';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersService } from './orders.service';

@UseGuards(RolesGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Roles(Role.CUSTOMER)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Req() req: Request & { user: AuthUser }, @Body() dto: CreateOrderDto) {
    return this.ordersService.createOrder(req.user.userId, dto);
  }

  @Roles(Role.CUSTOMER, Role.STORE_MANAGER)
  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: Request & { user: AuthUser }) {
    return this.ordersService.getOrder(id, req.user.userId, req.user.role);
  }

  @Roles(Role.KITCHEN_MANAGER)
  @Patch(':id/status')
  markReady(@Param('id') id: string) {
    return this.ordersService.markAsReady(id);
  }
}
