import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdvanceTimeDto } from './dto/advance-time.dto';
import { KitchenService } from './kitchen.service';

@ApiTags('kitchen')
@UseGuards(RolesGuard)
@Controller('kitchen')
export class KitchenController {
  constructor(private readonly kitchenService: KitchenService) {}

  @Roles(Role.KITCHEN_MANAGER)
  @Get('monitor')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Live kitchen state — oven slots and queue (KITCHEN_MANAGER)' })
  @ApiResponse({ status: 200, description: 'Current oven occupancy and waiting queue' })
  @ApiResponse({ status: 403, description: 'Forbidden — KITCHEN_MANAGER role required' })
  getMonitor() {
    return this.kitchenService.getMonitorState();
  }

  @Public()
  @Post('advance-time')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Advance kitchen clock by N minutes (test environments only)' })
  @ApiResponse({ status: 200, description: 'Clock advanced; returns completedJobs count' })
  @ApiResponse({ status: 404, description: 'Endpoint disabled outside test environment' })
  advanceTime(@Body() dto: AdvanceTimeDto) {
    return this.kitchenService.advanceTime(dto.minutes);
  }
}
