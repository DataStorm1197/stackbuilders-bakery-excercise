import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdvanceTimeDto } from './dto/advance-time.dto';
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

  @Public()
  @Post('advance-time')
  @HttpCode(HttpStatus.OK)
  advanceTime(@Body() dto: AdvanceTimeDto) {
    return this.kitchenService.advanceTime(dto.minutes);
  }
}
