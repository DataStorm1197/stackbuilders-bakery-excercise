import { Controller, Get, UseGuards } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { RolesGuard } from '../auth/guards/roles.guard';
import { KitchenService } from './kitchen.service';

@UseGuards(RolesGuard)
@Controller('kitchen')
export class KitchenController {
  constructor(private readonly kitchenService: KitchenService) {}

  @Roles(Role.KITCHEN_MANAGER)
  @Get('monitor')
  getMonitor() {
    return this.kitchenService.getMonitorState();
  }
}
