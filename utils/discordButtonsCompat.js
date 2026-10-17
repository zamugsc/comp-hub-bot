const BaseMessageComponent = require('discord-buttons/src/v12/Classes/interfaces/BaseMessageComponent');

let installed = false;

function installDiscordButtonsCompat() {
  if (installed) return;
  const create = BaseMessageComponent.create;
  BaseMessageComponent.create = function createCompatibleComponent(data) {
    // discord-buttons 4 treats `id` as a legacy alias for `custom_id`. Discord
    // now also returns an unrelated numeric component id beside the action id.
    if (data && [2, 3].includes(data.type) && typeof data.id === 'number' && typeof data.custom_id === 'string') {
      return create.call(this, { ...data, id: undefined });
    }
    return create.call(this, data);
  };
  installed = true;
}

module.exports = installDiscordButtonsCompat;
