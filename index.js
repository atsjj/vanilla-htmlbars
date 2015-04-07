module.exports = {
  name: 'htmlbars',

  isDevelopingAddon: function() {
    return true;
  },

  included: function(app) {
    this._super.included(app);

    app.import('vendor/htmlbars-runtime.amd.js');
  }
};
