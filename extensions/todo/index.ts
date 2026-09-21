import { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { defineEnum } from '../../utils/enum';

const TODO_STATUS = defineEnum({
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  REVIEW: 'review',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  BLOCKED: 'blocked',
});

export default function (pi: ExtensionAPI) {}
