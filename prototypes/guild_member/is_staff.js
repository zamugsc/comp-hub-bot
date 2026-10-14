const { GuildMember } = require('discord.js');
const config = require('../../config');

/**
 * Returns if a member is a staff member
 * @returns boolean
 */
// eslint-disable-next-line func-names
GuildMember.prototype.isStaff = function () {
  const staffRole = config.roles && config.roles.staff_role;
  // hasPermission also preserves the server owner's access.
  return this.hasPermission(['ADMINISTRATOR'])
    || (typeof staffRole === 'string' && staffRole.length > 0 && this.hasRole(staffRole));
};
