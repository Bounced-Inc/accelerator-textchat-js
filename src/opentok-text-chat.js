/* global OTKAnalytics define */
(function () {

  /** Include external dependencies */

  var _;
  var $;
  var axios;
  var crypto;
  var OTKAnalytics;

  if (typeof module === 'object' && typeof module.exports === 'object') {
    /* eslint-disable import/no-unresolved */
    _ = require('underscore');
    $ = require('jquery');
    axios = require('axios');
    crypto = require('crypto');
    window.jQuery = $;
    window.moment = require('moment');
    require('kuende-livestamp');
    OTKAnalytics = require('opentok-solutions-logging');
    /* eslint-enable import/no-unresolved */
  } else {
    _ = this._;
    $ = this.$;
    axios = this.axios;
    crypto = this.crypto;
    window.jQuery = $;
    window.moment = this.moment;
    OTKAnalytics = this.OTKAnalytics;
  }


  // Reference to instance of TextChatAccPack
  var _this;
  var _session;

  /** Analytics */
  var _otkanalytics;

  var _logEventData = {
    // vars for the analytics logs. Internal use
    clientVersion: 'js-vsol-x.y.z', // x.y.z filled by npm build script
    componentId: 'textChatAccPack',
    name: 'guidTextChatAccPack',
    actionInitialize: 'Init',
    actionStart: 'Start',
    actionEnd: 'End',
    actionOpen: 'OpenTC',
    actionClose: 'CloseTC',
    actionSendMessage: 'SendMessage',
    actionReceiveMessage: 'ReceiveMessage',
    actionSetMaxLength: 'SetMaxLength',
    variationAttempt: 'Attempt',
    variationError: 'Failure',
    variationSuccess: 'Success'
  };

  // Set constants
  const token = localStorage.getItem('token');

  axios.defaults.baseURL = process.env.REACT_APP_BUILD_ENV === 'development'
    ? process.env.REACT_APP_DEV_BASE_URL
    : process.env.REACT_APP_PROD_BASE_URL;
  axios.defaults.headers.common.Authorization = 'Bearer ' + token;

  const eventId = window.location.pathname.replace('/events/', '').replace('/virtual', '');

  var _logAnalytics = function () {

    // init the analytics logs
    var _source = window.location.href;

    var otkanalyticsData = {
      clientVersion: _logEventData.clientVersion,
      source: _source,
      componentId: _logEventData.componentId,
      name: _logEventData.name
    };

    _otkanalytics = new OTKAnalytics(otkanalyticsData);

    var sessionInfo = {
      sessionId: _session.id,
      connectionId: _session.connection.connectionId,
      partnerId: _session.apiKey
    };

    _otkanalytics.addSessionInfo(sessionInfo);

  };

  var _log = function (action, variation) {
    var data = {
      action: action,
      variation: variation
    };
    _otkanalytics.logEvent(data);
  };

  /** End Analytics */

  // State vars
  var _enabled = false;
  var _displayed = false;
  var _initialized = false;
  var _controlAdded = false;
  var _sender;
  var _composer;
  var _newMessages;

  // Reference to Accelerator Pack Common Layer
  var _accPack;

  var _triggerEvent = function (event, data) {
    _accPack && _accPack.triggerEvent(event, data);
  };

  // Private methods
  var renderUILayout = function () {
    /* eslint-disable max-len, prefer-template */
    return [
      '<div class="ots-text-chat-container">',
      '<div class="ots-text-chat">',
      '<div class="ots-messages-header ots-hidden" id="chatHeader">',
      '<span>Chat with</span>',
      '</div>',
      '<div id="otsChatWrap">',
      '<div class="ots-messages-holder" id="messagesHolder">',
      '<div class="ots-message-item ots-message-sent">',
      '</div>',
      '</div>',
      '<div class="ots-send-message-box">',
      '<input type="text" maxlength=' + _this.options.limitCharacterMessage + ' class="ots-message-input" placeholder="Enter your message here" id="messageBox">',
      '<button class="ots-icon-check" id="sendMessage" type="submit"></button>',
      '</div>',
      '</div>',
      '</div>',
      '</div>'
    ].join('\n');
    /* eslint-enable max-len, prefer-template */
  };

  var _cleanComposer = function () {
    _composer.value = '';
    $('#characterCount').text('0');
  };

  var _getBubbleHtml = function (message) {
    /* eslint-disable max-len, prefer-template */
    const pendingMessageClass = 'ots-item-timestamp ' + message.deliveryToken;
    var bubble = [
      '<div class="' + message.messageClass + '" >',
      '<div class="ots-user-name-initial"> ' + message.username[0] + '</div>',
      message.renderAsPending
        ? '<div class="' + pendingMessageClass + '"> Sending... </div>'
        : '<div class="ots-item-timestamp">' + message.username + ', <span data-livestamp=" ' + new Date(message.time) + '" </span></div>',
      '<div class="ots-item-text">',
      '<span> ' + message.message + '</span>',
      '</div>',
      '</div>'
    ].join('\n');
    /* eslint-enable max-len, prefer-template */
    return bubble;
  };

  var _renderChatMessage = function (
    messageSenderId,
    messageSenderAlias,
    message,
    sentOn,
    deliveryToken,
    renderAsPending = false
  ) {
    // _sender.id is randomly generated; we need to use _session... (myUid) to check user id
    const myUid = JSON.parse(_session.connection.data).user;
    const sentByClass = messageSenderId === myUid || _sender.id === messageSenderId ?
      'ots-message-item ots-message-sent' :
      'ots-message-item';

    const view = _getBubbleHtml({
      username: messageSenderAlias,
      message: message,
      messageClass: sentByClass,
      time: sentOn,
      deliveryToken,
      renderAsPending,
    });

    const chatholder = $(_newMessages);
    chatholder.append(view);
    chatholder[0].scrollTop = chatholder[0].scrollHeight;

  };

  // This function is triggered as soon as message delivery ATTEMPT starts
  var _handleMessageSent = function (data) {
    _cleanComposer();
    // Render message immediately, but with "Sending" text (renderAsPending = true)
    _renderChatMessage(
      _sender.id,
      _sender.alias,
      data.message,
      data.sentOn,
      data.deliveryToken,
      true
    );
    _triggerEvent('messageSent', data);
  };

  var _handleMessageError = function (error) {
    console.log(error.code, error.message);
    if (error.code === 500) {
      var view = _.template($('#chatError').html());
      $(_this.comms_elements.messagesView).append(view());
    }
    _triggerEvent('errorSendingMessage', error);
  };

  var _sendMessage = function (message, deliveryToken) {
    var deferred = new $.Deferred();

    // Add SEND_MESSAGE attempt log event
    _log(_logEventData.actionSendMessage, _logEventData.variationAttempt);

    // POST message to /chats route along with randomly generated deliveryToken
    // (for client to verify message was sent succesfully on signal receipt)
    const url = '/api/events/' + eventId + '/chats';
    axios.post(url, { message: message, deliveryToken })
      .then(deferred.resolve())
      .catch(function (err) {
        console.log(err);
      });

    return deferred.promise();
  };

  var _sendTxtMessage = function (text) {
    if (!_.isEmpty(text)) {
      const deliveryToken = crypto.randomBytes(3).toString('hex');
      $.when(_sendMessage(text, deliveryToken))
        .then(function () {
          _handleMessageSent({
            sender: {
              id: _sender.id,
              alias: _sender.alias
            },
            message: text,
            deliveryToken,
            sentOn: Date.now()
          });

          if (this.futureMessageNotice) {
            this.futureMessageNotice = false;
          }
        }, function (error) {
          _handleMessageError(error);
        });
    }
  };

  var _setupUI = function () {

    // Add INITIALIZE success log event
    _log(_logEventData.actionInitialize, _logEventData.variationAttempt);

    var parent = document.querySelector(_this.options.textChatContainer) || document.body;

    var chatView = document.createElement('section');
    chatView.innerHTML = renderUILayout();

    _composer = chatView.querySelector('#messageBox');

    _newMessages = chatView.querySelector('#messagesHolder');

    _composer.onkeyup = function updateCharCounter() {
      $('#characterCount').text(_composer.value.length);
      if (_composer.value.length !== 0) {
        $('.ots-icon-check').addClass('active');
      } else {
        $('.ots-icon-check').removeClass('active');
      }
    };

    _composer.onkeydown = function controlComposerInput(event) {
      var isEnter = (event.which === 13 || event.keyCode === 13);
      if (!event.shiftKey && isEnter) {
        event.preventDefault();
        _sendTxtMessage(_composer.value);
      }
    };

    parent.appendChild(chatView);

    document.getElementById('sendMessage').onclick = function () {
      _sendTxtMessage(_composer.value);
    };
    // Add INITIALIZE success log event
    _log(_logEventData.actionInitialize, _logEventData.variationSuccess);
  };

  var _onIncomingMessage = function (signal) {
    _log(_logEventData.actionReceiveMessage, _logEventData.variationAttempt);

    // If message's sender is not user, render incoming message as chatbubble
    // Else, message was sent by user: update "sending" message to "sender name, timeago text"
    const myUid = JSON.parse(_session.connection.data).user;
    if (myUid !== signal.data.sender._id) {
      _renderChatMessage(
        signal.data.sender._id,
        signal.data.sender.name,
        signal.data.message,
        signal.data.createdAt
      );
    } else {
      const newItemTimestamp = '<div class="ots-item-timestamp">' + signal.data.sender.name + ', <span data-livestamp=" ' + new Date(signal.data.createdAt) + '" </span></div>';
      // Get div with deliveryToken class and replace with name + timeago
      $('.' + signal.data.deliveryToken).replaceWith(newItemTimestamp);
    }

    _log(_logEventData.actionReceiveMessage, _logEventData.variationSuccess);
  };

  var _handleTextChat = function (event) {
    var handler = _onIncomingMessage(event);
    if (handler && typeof handler === 'function') {
      handler(event);
    }
    _triggerEvent('messageReceived', event);
  };

  var _initTextChat = function () {
    _log(_logEventData.actionStart, _logEventData.variationAttempt);
    _enabled = true;
    _displayed = true;
    _initialized = true;
    _setupUI();
    _triggerEvent('showTextChat');
    _session.on('signal:text-chat', _handleTextChat);
    _log(_logEventData.actionStart, _logEventData.variationSuccess);

    // Populate chat with past 100 messages
    const url = '/api/events/' + eventId + '/chats';
    axios.get(url)
      .then(function (res) {
        res.data.reverse().forEach(function (data) {
          _renderChatMessage(
            data.sender._id,
            data.sender.name,
            data.message,
            data.createdAt
          );
        });
      })
      .catch(function (err) {
        console.log(err);
      });
  };

  var _showTextChat = function () {
    _log(_logEventData.actionOpen, _logEventData.variationAttempt);
    document.querySelector(_this.options.textChatContainer).classList.remove('ots-hidden');
    _displayed = true;
    _triggerEvent('showTextChat');

    // Add OPEN success log event
    _log(_logEventData.actionOpen, _logEventData.variationSuccess);
  };

  var _hideTextChat = function () {
    _log(_logEventData.actionClose, _logEventData.variationAttempt);
    _log(_logEventData.actionEnd, _logEventData.variationAttempt);
    document.querySelector(_this.options.textChatContainer).classList.add('ots-hidden');
    _displayed = false;
    _triggerEvent('hideTextChat');

    // Add CLOSE success log event
    _log(_logEventData.actionClose, _logEventData.variationSuccess);
    _log(_logEventData.actionEnd, _logEventData.variationSuccess);
  };

  var _appendControl = function () {

    var feedControls = document.querySelector(_this.options.controlsContainer);

    var el = document.createElement('div');
    el.innerHTML = '<div class="ots-video-control circle text-chat enabled" id="enableTextChat"></div>';

    var enableTextChat = el.firstChild;
    feedControls.appendChild(enableTextChat);

    _controlAdded = true;

    enableTextChat.onclick = function () {

      if (!_initialized) {
        _initTextChat();
      } else if (!_displayed) {
        _showTextChat();
      } else {
        _hideTextChat();
      }
    };
  };

  var _validateOptions = function (options) {

    if (!options.session) {
      throw new Error('Text Chat Accelerator Pack requires an OpenTok session.');
    }

    // Generates a random alpha-numeric string of n length
    var uniqueString = function (length) {
      var len = length || 3;
      return Math.random().toString(36).substr(2, len);
    };

    // Returns session id prepended and appended with unique strings
    var generateUserId = function () {
      return [uniqueString(), _session.id, uniqueString()].join('');
    };

    _session = _.property('session')(options);
    _accPack = _.property('accPack')(options);

    /**
     * Create arbitary values for sender id and alias if not recieved
     * in options hash.
     */
    _sender = _.defaults(options.sender || {}, {
      id: generateUserId(),
      alias: ['User', uniqueString()].join(' ')
    });

    return _.defaults(_.omit(options, ['accPack', '_sender']), {
      limitCharacterMessage: 6000,
      controlsContainer: '#feedControls',
      textChatContainer: '#chatContainer',
      alwaysOpen: false,
      appendControl: true,
    });
  };

  var _registerEvents = function () {
    var events = [
      'showTextChat',
      'hideTextChat',
      'messageSent',
      'errorSendingMessage',
      'messageReceived'
    ];
    _accPack && _accPack.registerEvents(events);
  };

  var _addEventListeners = function () {

    if (_accPack) {
      _accPack.registerEventListener('startCall', function () {
        if (!_this.options.alwaysOpen) {
          if (_controlAdded) {
            document.querySelector('#enableTextChat').classList.remove('ots-hidden');
          } else {
            _this.options.appendControl && _appendControl();
          }
        }
      });

      _accPack.registerEventListener('endCall', function () {
        if (!_this.options.alwaysOpen) {
          document.getElementById('enableTextChat').classList.add('ots-hidden');
          if (_displayed) {
            _hideTextChat();
          }
        }
      });
    }
  };

  // Constructor
  var TextChatAccPack = function (options) {

    _initialized = false;

    // Save a reference to this
    _this = this;

    // Extend instance and set private vars
    _this.options = _validateOptions(options);

    // Init the analytics logs
    _logAnalytics();

    if (!!_.property('_this.options.limitCharacterMessage')(options)) {
      _log(_logEventData.actionSetMaxLength, _logEventData.variationSuccess);
    }

    if (_this.options.alwaysOpen) {
      _initTextChat();
    } else {
      _this.options.appendControl && _appendControl();
    }
    _registerEvents();
    _addEventListeners();
  };

  TextChatAccPack.prototype = {
    constructor: TextChatAccPack,
    isEnabled: function () {
      return _enabled;
    },
    isDisplayed: function () {
      return _displayed;
    },
    showTextChat: function () {
      _showTextChat();
    },
    hideTextChat: function () {
      _hideTextChat();
    }
  };

  if (typeof exports === 'object') {
    module.exports = TextChatAccPack;
  } else if (typeof define === 'function' && define.amd) {
    define(function () {
      return TextChatAccPack;
    });
  } else {
    this.TextChatAccPack = TextChatAccPack;
  }

}.call(this));
