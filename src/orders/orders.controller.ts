import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthUser } from '../auth/strategies/jwt.strategy';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Roles(Role.CUSTOMER)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Place a new order (CUSTOMER)' })
  @ApiResponse({ status: 201, description: 'Order created and queued in the kitchen' })
  @ApiResponse({ status: 400, description: 'Invalid menu item IDs or payload' })
  @ApiResponse({ status: 403, description: 'Forbidden — CUSTOMER role required' })
  create(@Req() req: Request & { user: AuthUser }, @Body() dto: CreateOrderDto) {
    return this.ordersService.createOrder(req.user.userId, dto);
  }

  @Roles(Role.CUSTOMER, Role.STORE_MANAGER)
  @Get(':id')
  @ApiOperation({ summary: 'Get order details (CUSTOMER sees own orders; STORE_MANAGER sees all)' })
  @ApiResponse({ status: 200, description: 'Order details' })
  @ApiResponse({ status: 403, description: 'Forbidden — customers can only view their own orders' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  findOne(@Param('id') id: string, @Req() req: Request & { user: AuthUser }) {
    return this.ordersService.getOrder(id, req.user.userId, req.user.role);
  }

  @Roles(Role.KITCHEN_MANAGER)
  @Patch(':id/status')
  @ApiOperation({ summary: 'Mark an order as READY (KITCHEN_MANAGER)' })
  @ApiResponse({ status: 200, description: 'Order status updated to READY' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({ status: 403, description: 'Forbidden — KITCHEN_MANAGER role required' })
  markReady(@Param('id') id: string) {
    return this.ordersService.markAsReady(id);
  }
}
