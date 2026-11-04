// An example Keeper extension (docs/EXTENSIONS.md). It runs in a worker of its
// own; `keeper` is the only way to reach Keeper, and each call needs a permission.
keeper.onCommand('hello', async () => {
  await keeper.notify('Hello from an extension');
});

keeper.onCommand('catch-date', async () => {
  const day = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  await keeper.catch(`Notes for ${day}`);
  await keeper.notify('Caught in your Inbox');
});
