/**
 * Root class for all Message Type Models.
 *
 * A Message Type Model represents an abstraction of a Layer.Core.Message that
 * contains an understanding of the content it represents and how to map between
 * a structure of MessageParts and that content.
 *
 * Subclasses of Message Type Model can be used to define representations of
 * Text Messages, Image Messages, Product Messages, etc...
 *
 * Each Layer.Core.Message should only have a single instance of a Message Type Model;
 * to maintain this connection, they will share UUIDs.
 *
 * @class  Layer.Core.MessageTypeModel
 * @extends Layer.Core.Root
 */
import { client as Client } from '../../settings';
import Core from '../namespace';
import Util from '../../utils';
import Root from '../root';
import Message from './message';
import Identity from './identity';
import { ErrorDictionary } from '../layer-error';
import ResponseSummaryModel from './message-type-response-summary-model';

class MessageTypeModel extends Root {
  /**
   * Create a Model representing/abstracting a Message's data.
   *
   * @method constructor
   * @param {Object} options
   * @param {Layer.Core.Message} options.message
   * @param {Layer.Core.MessagePart} options.part
   * @private
   * @return {Layer.Core.MessageTypeModel}
   */
  constructor(options = {}) {
    if (!options.action) options.action = {};

    super(options);
    this.responses = new ResponseSummaryModel();

    if (!this.customData) this.customData = {};
    this.currentMessageRenderer = this.constructor.messageRenderer;
    this.currentMessageRendererExpanded = this.constructor.messageRendererExpanded;
    this.childParts = [];
    this.childModels = [];
    if (this.message) {
      this._setupMessage();
      // Some anonymous models will have a message but not have a part to parse
      if (this.part) {
        this.parseMessage();
      }
    }
  }

  /**
   * Send this Message Type Model within the specified Conversation
   *
   * Simplest usage, which will generate a suitable notification for this message:
   *
   * ```
   * model.send({
   *    conversation: myConversation
   * });
   * ```
   *
   * The full API?
   *
   * ```
   * model.send({
   *    conversation: myConversation,
   *    notification: {
   *      title: "New Message from " + Layer.client.user.displayName,
   *      text: model.getOneLineSummary(),
   *      sound: 'bleep.aiff'
   *    },
   *    callback(message) {
   *       console.log("Generated and sending " + message.id);
   *       message.once('messages:sent', function(evt) {
   *         console.log("Message Sent " + message.id);
   *       });
   *    }
   * });
   * ```
   *
   * The send method takes a `notification` object. In normal use, it provides the same notification to ALL
   * recipients, but you can customize notifications on a per recipient basis, as well as embed actions into the notification.
   *
   * For the Full Notification API, see [Server Docs](https://docs.layer.com/reference/server_api/push_notifications.out).
   *
   * Finally, if you want to customize the message before sending it, see {@link #generateMessage} instead.
   *
   * @method send
   * @param {Object} options
   * @param {Layer.Core.Container} options.conversation   The Conversation/Channel to send this message on
   * @param {Object} [options.notification]               Parameters for controling how the phones manage notifications of the new Message.
   *                                                      See IOS and Android docs for details.
   * @param {String} [options.notification.title]         Title to show on lock screen and notification bar
   * @param {String} [options.notification.text]          Text of your notification
   * @param {String} [options.notification.sound]         Name of an audio file or other sound-related hint
   * @param {Function} [options.callback]                 Function to call with generated Message;
   *                                                      Message state should be "sending" but not yet
   *                                                      received by the server
   * @param {Layer.Core.Message} [options.callback.message]
   * @return {Layer.Core.MessageTypeModel} this
   */
  send({ conversation, notification, callback }) {
    if (notification === undefined) notification = this.getNotification();
    return this.generateMessage(conversation, (message) => {
      if (message.isNew()) message.send(notification);
      if (callback) callback(message);
    });
  }

  /**
   * Generate a Layer.Core.Message from this Model.
   *
   * This method returns the Layer.Core.Message asynchronously as some models
   * may require processing of data prior to writing data into the Layer.Core.MessagePart objects.
   *
   * ```
   * model.generateMessage(conversation, function(message) {
   *     message.send();
   * });
   * ```
   *
   * > *Note*
   * >
   * > A model can have only a single message; calling `generateMessage()` a second time
   * > will do nothing other than call `callback` with the existing message.
   *
   * @method generateMessage
   * @param {Layer.Core.Conversation} conversation
   * @param {Function} callback
   * @param {Layer.Core.Message} callback.message
   * @return {Layer.Core.MessageTypeModel} this
   */
  generateMessage(conversation, callback) {
    if (this.message) return callback(this.message);
    if (!conversation) throw new Error(ErrorDictionary.conversationMissing);
    if (!(conversation instanceof Root)) throw new Error(ErrorDictionary.conversationMissing);
    this.generateParts((parts) => {
      this.childParts = parts;
      this.part.mimeAttributes.role = 'root';
      // this.part.mimeAttributes.xdkVersion = 'webxdk-' + version;
      this.message = conversation.createMessage({
        id: Message.prefixUUID + this.id.replace(/\/parts\/.*$/, '').replace(/^.*MessageTypeModels\//, ''),
        parts: this.childParts,
      });

      Client._removeMessageTypeModel(this);
      this.id = MessageTypeModel.prefixUUID + this.part.id.replace(/^.*messages\//, '');
      Client._addMessageTypeModel(this);
      this._setupMessage();
      this.parseModelChildParts({ changes: this.childParts.map(part => ({ type: 'added', part })), isEdit: false });
      if (callback) callback(this.message);
    });
    return this;
  }

  /**
   * Provide a generateParts method so that your model can be turned into a Message when generating it locally.
   *
   * @abstract
   * @protected
   * @method generateParts
   * @param {Function} callback
   * @param {Layer.Core.MessagePart[]} callback.parts  Array of Message Parts to be added to the new message
   */

  /**
   * Adds a Model (submodel) to this Model; for use from `generateParts` *only*.
   *
   * Note that adding a role name is needed for proper parsing of the Message by recipients of the Message.
   *
   * ```
   * generateParts(callback) {
   *     this.part = new MessagePart({
   *         mimeType: this.constructor.MIMEType,
   *         body: JSON.stringify({}),
   *     });
   *     if (this.subModel) {
   *         model.addChildModel(subModel, 'some-role', function(parts) {
   *             callback([this.part].concat(parts));
   *         });
   *     }
   * }
   * ```
   *
   * @protected
   * @method addChildModel
   * @param {Layer.Core.MessageTypeModel} model    The sub-model to add to this model
   * @param {String} role                          The role to assign the sub-model
   * @param {Function} callback                    The function to call when the sub-model has generated its parts
   * @param {Layer.Core.MessagePart[]} parts       Array of Parts that should be added to the Message
   */
  addChildModel(model, role, callback) {
    model.generateParts((moreParts) => {
      moreParts[0].mimeAttributes.role = role;
      moreParts[0].mimeAttributes['parent-node-id'] = this.part.nodeId;
      if (callback) callback(moreParts);
    });
  }

  /**
   * Adds a Child Message Part to this Model; for use from `generateParts` *only*.
   *
   * Use {@link #addChildModel} if this Message Part is represented by a Message Type Model.
   *
   * * Note that adding a role name is needed for proper parsing of the Message by recipients of the Message.
   *
   * ```
   * generateParts(callback) {
   *     this.part = new MessagePart({
   *         mimeType: this.constructor.MIMEType,
   *         body: JSON.stringify({}),
   *     });
   *     if (this.source) {
   *         this.source = new Layer.Core.MessagePart({
   *             mimeType: "my-custom/mime-type",
   *             body: "my-data"
   *         });
   *         this.addChildPart(this.source, "source");
   *     }
   * }
   * ```
   *
   * @method addChildPart
   * @protected
   * @param {Layer.Core.MessagePart} part
   * @param {String} role
   */
  addChildPart(part, role) {
    part.mimeAttributes.role = role;
    part.mimeAttributes['parent-node-id'] = this.part.nodeId;
  }

  /**
   * Setup any Layer.Core.Message so that its bound to this Model.
   *
   * This method will take whatever `this.message` contains and do setup upon it.
   *
   * When completed, Layer.Core.MessageTypeModel.parseModelPart is called upon it
   * unless explicitly suppressed.
   *
   * @method _setupMessage
   * @private
   */
  _setupMessage() {

    // Typically, every model will have a part; however, there are some special cases where
    // an "anonymous" submodel may be created, such as is done when the ButonModel creates a ChoiceModel
    // that is not directly associated with a part, but is indirectly associated (handled via `parentId` property)
    if (this.part) {
      if (!this.part.body) this.part.fetchContent();
      if (!this.id) {
        // The Model ID is derived from the Message ID so that they are linked together in a 1-to-1 relationship.
        this.id = MessageTypeModel.prefixUUID + this.part.id.replace(/^.*messages\//, '');
      }

      // Call handlePartChanges any message edits that update a part.
      this.part.on('messageparts:change', this._handlePartChanges, this);

      // Gather all of the Child Nodes so that any subclass can directly iterate over relevant parts
      this.childParts = this.message.getPartsMatchingAttribute({
        'parent-node-id': this.nodeId,
      });
      this.childModels = this.childParts.map(part => part.createModel()).filter(model => model);

      this.childParts.forEach(part => part.on('messageparts:change', this._handlePartChanges, this));
    } else {
      this.childParts = [];
      this.childModels = [];
    }

    // For any part added/removed call suitable handlers (and remove any older handlers which mostly only show up in unit tests)
    this.message.off('messages:part-added', this._handlePartAdded, this);
    this.message.off('messages:part-removed', this._handlePartRemoved, this);
    this.message.on('messages:part-added', this._handlePartAdded, this);
    this.message.on('messages:part-removed', this._handlePartRemoved, this);

    // If the message is destroyed, destroy the model as well
    this.message.on('destroy', this.destroy, this);

    // Register this model so that it can be retrieved instead of re-instantiated
    Client._addMessageTypeModel(this);
  }

  /**
   * Generate the {@link Layer.Core.MessagePart#body} field to represent this Message Type Model.
   *
   * This is for use from {@link #generateParts} to build a `body` object which can be serialized via `JSON.stringify`.
   *
   * Specify as input what properties go into the `body` (handles string/number/boolean only).
   *
   * This code snippet will copy the author, size and title properties into the MessagePart `body`
   * of the Part being generated.
   *
   * This method also converts all camelCase property names into snake_case property names.
   *
   * ```
   * var body = this.initBodyWithMetadata(['author', 'size', 'title']);
   * this.part = new MessagePart({
   *   mimeType: this.constructor.MIMEType,
   *   body: JSON.stringify(body),
   * });
   * ```
   *
   * @method initBodyWithMetadata
   * @protected
   * @param {String[]} fields
   * @returns {String}
   */
  initBodyWithMetadata(fields) {
    const body = { };
    const newFields = ['action', 'customData'].concat(fields);
    newFields.forEach((fieldName) => {
      if (this.propertyHasValue(fieldName)) {
        if (Array.isArray(this[fieldName]) && this[fieldName].length === 0) return;
        body[Util.hyphenate(fieldName, '_')] = this[fieldName];
      }
    });
    return body;
  }

  /**
   * Used by {@link #initBodyWithMetadata} to determine if a given property has a value to write to the `body`.
   *
   * Any property whose value is different from its prototype would typically be written... but
   * Object properties can _never_ be built into the prototype (else they become static properties shared among all instances)
   * and so custom tests must be added here and to subclasses.
   *
   * This method prevents us from writing every property to `body` and instead only write those with relevant data.
   *
   * Provide a custom subclass for this method if your class needs changes to this test.
   *
   * @method propertyHasValue
   * @protected
   * @param {String} fieldName   The property name whose value may/may-not be worth writing.
   * @returns {Boolean} Should the value be written
   */
  propertyHasValue(fieldName) {
    if (fieldName === 'action' && Util.isEmpty(this.action)) return false;
    if (fieldName === 'customData' && Util.isEmpty(this.customData)) return false;
    if (this[fieldName] === this.constructor.prototype[fieldName]) return false;
    return true;
  }


  /**
   * Setup this instance's properties, responses, sub-message-parts and submodels.
   *
   * This method is called once, when instantiating a new instance.
   *
   * This method will:
   *
   * * Call {@link #parseModelPart} to setup this model from its main Layer.Core.MessagePart
   * * Initialize {@link #responses} and if needed, call {@link #parseModelResponses}
   * * Call {@link #parseModelChildParts} to load in any child models/child message parts
   *
   * @protected
   * @method parseMessage
   */
  parseMessage() {
    const responses = this.childParts.filter(part => part.mimeAttributes.role === 'response_summary')[0];

    this.parseModelPart({
      payload: this.part.body ? JSON.parse(this.part.body) : {},
      isEdit: false,
    });
    if (responses) this._parseModelResponses(responses);
    this.parseModelChildParts({ changes: this.childParts.map(part => ({ type: 'added', part })), isEdit: false });
  }

  /**
   * This method parses the {@link #part} to extract the information that will be managed by the model.
   *
   * `parseModelPart` is called for intialization, and is also recalled
   * whenever this Model's Layer.Core.MessagePart is modified (locally or remotely).
   *
   * There may be cases where changes to properties via an Edit to the MessagePart need to be handled differently
   * from initializing your Model from the Part.
   *
   * The root class implementation of this method will import each property from payload into the properties of
   * this instance (converting from snake case to cammel case).
   *
   * Subclass this method to add additional parsing specific to your custom Layer.Core.MessageTypeModel.
   *
   * @method parseModelPart
   * @protected
   * @param {Object} options
   * @param {Object} options.payload    This is the body of `this.part` after running it through `JSON.parse(this.part.body)`
   * @param {Boolean} options.isEdit    If this method is called in response to an update to the Layer.Core.MessagePart then `isEdit` is `true`; for initialization it will be `false`.
   */
  parseModelPart({ payload, isEdit }) {
    Object.keys(payload).forEach((propertyName) => {
      const modelName = Util.camelCase(propertyName);
      if (modelName in this.constructor.prototype) {
        if (this[modelName] !== payload[propertyName]) {
          this._triggerAsync('message-type-model:change', {
            propertyName: modelName,
            oldValue: this[modelName],
            newValue: payload[propertyName],
          });
          this[modelName] = payload[propertyName];
        }
      }
    });
  }


  /**
   * This method parses the {@link #childParts} and {@link #childModels} to identify significant data that is needed for intialization.
   *
   * This method is called:
   *
   * * By {@link #parseMessage} when parsing a new Layer.Core.Message into a new Model.
   * * By {@link #generateMessage} to parse a newly (locally) generated message
   *
   * {@link #message}, {@link #childParts} and {@link #childModels} properties are already set and can help building the model.
   *
   * Common example of what a subclass implementation of this method may do:
   *
   * ```
   * parseModelChildParts({ changes = [], isEdit = false }) {
   *    super.parseModelPart({ payload, isEdit });
   *    this.source = this.childParts.filter(part => part.role === 'source')[0];  // Get the child MessagePart
   *    this.billingAddressModel = this.getModelsByRole('billing-address')[0];    // Get the child MessageTypeModel
   * }
   * ```
   *
   * > *Note*
   * >
   * > when this is called after `model.generateMessage()` new submodels are generated and replace any submodels
   * > that the Model was instantiated with.  This should be fixed within the XDK in the future.
   *
   * @method parseModelChildParts
   * @protected
   * @param {Object} options
   * @param {Object[]} options.changes  Array of changes to Child MessageParts
   * @param {Layer.Core.MessagePart} options.changes.part    The Layer.Core.MessagePart that changed
   * @param {String} options.changes.type   The type of change: 'added', 'removed', 'changed'
   * @param {Boolean} options.isEdit  Is the change an update to MessageParts or is this the intialization call
   */
  parseModelChildParts({ changes = [], isEdit = false }) {
    // No-op for now
    // TODO: Initialize properties by reflecting on prototypes and roles.
  }

  /**
   * Parse the Response Summary Layer.Core.MessagePart.
   *
   * Called when:
   *
   * * initializing with a Layer.Core.Message with an existing Repsonse Summary.
   * * A Response Summary part is added to the Layer.Core.Message
   * * A Response Summary part is removed from the Layer.Core.Message (input is `null`)
   * * A Response Summary part is updated with new responses
   *
   * @method _parseModelResponses
   * @private
   * @param {Layer.Core.MessagePart} responsePart
   */
  _parseModelResponses(responsePart) {
    if (responsePart) {
      const oldData = this.responses._participantData;
      if (this.responses.parseResponsePart(responsePart)) {
        this.parseModelResponses(); // Call the public method that lets each model update its state
        this._triggerAsync('message-type-model:change', {
          propertyName: 'responses._participantData',
          oldValue: oldData,
          newValue: this.responses._participantData,
        });
      }
    } else {
      const oldData = this.responses._participantData;
      this.responses.reset();
      this.parseModelResponses(); // Call the public method that lets each model update its state
      this._triggerAsync('message-type-model:change', {
        propertyName: 'responses._participantData',
        oldValue: oldData,
        newValue: this.responses._participantData,
      });
    }
  }


  /**
   * Whenever {@link #responses} changes as a result of *any* User posting a Response Message,
   * this method is called to let each model process the new responses.
   *
   * @protected
   * @abstract
   * @method parseModelResponses
   */
  parseModelResponses() { }

  /**
   * Whenever a relevant part has changed, reparse the message.
   *
   * This handler is called whenever:
   *
   * * `this.part` is changed
   * * Any part within `this.childParts` is changed
   * * Any part is added/removed from `this.childParts`
   *
   * Any time the underlying message changes, Layer.Core.MessageTypeModel.parseModelPart is recalled
   * so that the Model can be rebuilt.
   *
   * > *Note*
   * >
   * > If you manage state in your model, you must track whether this is your first call to
   * > `parseModelPart` in which all state can be updated, or a subsequent call in which
   * > you want to *not* overwrite some local state manipulations.
   *
   * @method _handlePartChanges
   * @private
   * @param {Layer.Core.LayerEvent} evt
   */
  _handlePartChanges(evt) {
    if (this.part && this.part === evt.target) {
      this.parseModelPart({
        payload: this.part.body ? JSON.parse(this.part.body) : {},
        isEdit: true,
      });
    } else if (evt.target.role === 'response_summary') {
      this._parseModelResponses(evt.target);
    } else {
      this.parseModelChildParts({ changes: [{ type: 'changed', part: evt.target }], isEdit: true });
    }
  }

  /**
   * A MessagePart has been removed.
   *
   * If the part is a Child Part, remove it from `this.childParts` and call
   * {@link #parseModelChildParts} which in turn will trigger model change events if needed.
   *
   * Assume that the root part of a Layer.Core.Message would never be removed as that would be an invalid operation.
   *
   * @method _handlePartRemoved
   * @private
   * @param {Layer.Core.LayerEvent} removeEvt
   */
  _handlePartRemoved(removeEvt) {
    const removedPart = removeEvt.part;
    const partIndex = this.childParts.indexOf(removedPart);
    if (partIndex !== -1) {
      this.childParts.splice(partIndex, 1);
    }

    this.childModels = this.childModels.filter(part => part.id !== removedPart.id);
    if (partIndex !== -1) {
      if (removedPart === this.responses.part) {
        this._parseModelResponses(null);
      } else {
        this.parseModelChildParts({ changes: [{ type: 'removed', part: removedPart }], isEdit: true });
      }
    }
  }

  /**
   * A MessagePart has been added.
   *
   * * If the new part is a Child Part call {@link #_handleChildPartAdded}
   * * If the new part added shares this model's Part ID, the update `this.part` to the newly received part, and
   *   let {@link #_handlePartChanges} process the new Part.
   * * If the MessagePart is not a replacement for this part, nor a new Child Part, ignore it
   *
   * @method _handlePartAdded
   * @private
   * @param {Layer.Core.LayerEvent} addEvt
   */
  _handlePartAdded(addEvt) {
    const part = addEvt.part;
    const parentId = part.parentId;

    if (parentId && parentId === this.nodeId) {
      this._handleChildPartAdded(part);
    } else if (this.part && part.nodeId === this.part.nodeId) {
      this.part = part;
      this._handlePartChanges(addEvt);
    }
  }

  /**
   * A new Child Part has been added to this Model/Message.
   *
   * * Update {@link #childParts}
   * * Update {@link #childModels}
   * * If its a Response Summary call {@link #_parseModelResponses}
   * * If its a regular child Message Part, call {@link #parseModelChildParts}
   *
   * @method _handleChildPartAdded
   * @private
   * @param {Layer.Core.MessagePart} part
   */
  _handleChildPartAdded(part) {
    this.childParts.push(part);
    const childModel = part.createModel();
    if (childModel) this.childModels.push(childModel);

    // Call _handlePartChanges any time a childPart has changed
    part.on('messageparts:change', this._handlePartChanges, this);
    if (!part.body) part.fetchContent();

    if (part.role === 'response_summary') {
      this._parseModelResponses(part);
    } else {
      this.parseModelChildParts({ changes: [{ type: 'added', part }], isEdit: true });
    }
  }

  /**
   * Used from {@link #parseModelChildParts} subclass implementations to gather submodels and assign them as properties.
   *
   * This code snippet shows how a submodel is generated from the Message for the specified role name:
   *
   * ```
   * parseModelChildParts({ changes, isEdit }) {
   *     super.parseModelPart({ changes, isEdit });
   *     this.billingAddressModel = this.getModelsByRole('billing-address')[0];
   *     this.productItems = this.getModelsByRole('product-item');
   * }
   * ```
   *
   * Specifically, it will search the {@link #childModels} for a MessageTypeModel whose `role` value
   * matches the specified role.  Note that `role` is part of the Layer.Core.MessagePart's MIME Type attributes.
   *
   * @method getModelsByRole
   * @protected
   * @param {String} role
   * @returns {Layer.Core.MessageTypeModel[]}
   */
  getModelsByRole(role) {
    return this.childModels.filter(model => model.role === role);
  }

  /**
   * Any event triggered upon this model will bubble up to the Layer.Core.Client.
   *
   * @private
   * @method _getBubbleEventsTo
   */
  _getBubbleEventsTo() {
    return Client;
  }

  // Parent method docuemnts this
  destroy() {
    Client._removeMessageTypeModel(this);
    delete this.message;
    super.destroy();
  }

  /* MANAGE METADATA */

  /**
   * Returns the title metadata; used by the `<layer-standard-message-view-container />`
   *
   * @method getTitle
   * @returns {String}
   */
  getTitle() {
    return this.title || '';
  }

  /**
   * Returns the description metadata; used by the `<layer-standard-message-view-container />`
   *
   * @method getDescription
   * @returns {String}
   */
  getDescription() {
    return '';
  }

  /**
   * Returns the footer metadata; used by the `<layer-standard-message-view-container />`
   *
   * @method getFooter
   * @returns {String}
   */
  getFooter() {
    return '';
  }

  /**
   * Generate a concise textual summary of the Message.
   *
   * This is currently used to represent the Layer.Core.Conversation.lastMessage.
   *
   * @method getOneLineSummary
   * @returns {String}
   */
  getOneLineSummary(ignoreTitle) {
    const title = this.getTitle();
    if (!ignoreTitle && title) {
      return title;
    }

    if (this.constructor.SummaryTemplate) {
      const templateStr = this.constructor.SummaryTemplate || '';
      const result = templateStr.replace(/(\$\{.*?\})/g, (match) => {
        const value = this[match.substring(2, match.length - 1)];
        if (value instanceof Identity) {
          return value.displayName;
        } else if (value instanceof MessageTypeModel) {
          return value.getOneLineSummary();
        } else if (value !== null) {
          return value;
        } else {
          return '';
        }
      });
      if (result) return result;
    }

    if (this.constructor.LabelSingular) {
      return this.constructor.LabelSingular;
    }
  }

  /**
   * Returns a notification object with suitable preset values for using in {@link Layer.Core.Message#send}
   *
   * @method getNotification
   * @return {Object}
   * @return {String} return.title    Notification title
   * @return {String} return.text     Body of the notification
   */
  getNotification() {
    const notification = {
      title: MessageTypeModel.NotificationTitle.replace(/(\$\{.*?\})/g, (match) => {
        const value = this[match.substring(2, match.length - 1)];
        return (value instanceof Identity) ? value.displayName : value;
      }),
      text: this.getOneLineSummary(),
    };

    this.trigger('message-type-model:notification', {
      notification,
      modelName: this.getModelName(),
    });

    return notification;
  }

  /**
   * Takes an action property and merges it into the existing action property.
   *
   * If the Layer.Core.MessageTypeModel.action already has an `event` property,
   * then this will be left untouched, else a new `event` will be copied in (if present
   * within `newValue`.
   *
   * For each subproperty within the Layer.Core.MessageTypeModel.action `data` property,
   * if it exists, leave it untouched, else copy in the value from `newValue`
   *
   * @method mergeAction
   * @protected
   * @param {Object} newValue    A new event and/or data for the action of this Model.
   */
  mergeAction(newValue) {

    // If there is no current event, copy in the new event (if there is one)
    if (!this.action.event) this.action.event = newValue.event;

    // The new data is the data passed in
    const newData = newValue.data || {};

    // The current data is the data (if any) from the existing action on this instance
    let currentData;
    if (this.action.data) {
      currentData = this.action.data;
    } else {
      this.action.data = currentData = {};
    }

    // Any property in newData gets copied into the currentData... if the property
    // isn't already defined in currentData.
    Object.keys(newData).forEach((propertyName) => {
      if (!(propertyName in currentData)) currentData[propertyName] = newData[propertyName];
    });
  }

  /**
   * Return the name of the Layer.Core.MessageTypeModel class that represents this Message; for use in simple tests.
   *
   * ```
   * if (model.getModelName() === "TextModel") {
   *    console.log("Yet another text message");
   * }
   * ```
   *
   * @method getModelName
   * @returns {String}
   */
  getModelName() {
    return this.constructor.altName || this.constructor.name;
  }

  // see role property docs below
  __getRole() {
    return this.part ? this.part.role : '';
  }

  // see actionEvent property docs below
  __getActionEvent() {
    return this.action.event !== undefined ? this.action.event : this.constructor.defaultAction;
  }

  // see actionData property docs below
  __getActionData() {
    return this.action.data || {};
  }

  // See nodeId property docs below
  __getNodeId() {
    return this.part ? this.part.nodeId : '';
  }

  // See parentId property docs below
  __getParentId() {
    return this.part ? this.part.parentId : this.__parentId;
  }

  __getMessageSender() {
    return this.message ? this.message.sender : Client.user;
  }

  __getMessageSentAt() {
    return this.message ? this.message.sentAt : null;
  }

  __getMessageRecipientStatus() {
    return this.message ? this.message.recipientStatus : null;
  }

  /**
   * Access the Message Type Submodel's parent Message Type Model in the Model tree.
   *
   * @method getParentModel
   * @returns {Layer.Core.MessageTypeModel}
   */
  getParentModel() {
    const parentId = this.parentId;
    const part = parentId ? this.message.findPart(aPart => aPart.nodeId === parentId) : null;
    return part ? part.createModel() : null;
  }

  /**
   * Multiple calls to _triggerAsync('message-type-model:change') should be replaced by a single 'message-type-model:change' event.
   *
   * @method _processDelayedTriggers
   * @private
   */
  _processDelayedTriggers() {
    if (this.isDestroyed) return;
    let hasChange = false;
    this._delayedTriggers = this._delayedTriggers.filter((evt) => {
      if (evt[0] === 'message-type-model:change' && !hasChange) {
        hasChange = true;
        return true;
      } else if (evt[0] === 'message-type-model:change') {
        return false;
      } else {
        return true;
      }
    });
    super._processDelayedTriggers();
  }

  toString() {
    return `[${this.constructor.name} ${this.id}]`;
  }

  __getTypeLabel() {
    return this.constructor.LabelSingular;
  }
}

/**
 * Unique identifier, derived from the associated Part ID.
 *
 * @property {string}
 */
MessageTypeModel.prototype.id = '';

/**
 * Property to reference the Parent node this model's Message Part's Parent Message Part within the Message Part Tree.
 *
 * @protected
 * @property {String}
 */
MessageTypeModel.prototype.parentId = null;

/**
 * Node Identifier to uniquely identify this Message Part such that a Parent ID can reference it.
 *
 * @readonly
 * @property {String}
 */
MessageTypeModel.prototype.nodeId = null;

/**
 * Message for this Message Model
 *
 * @property {Layer.Core.Message}
 */
MessageTypeModel.prototype.message = null;

/**
 * Message Parts that are directly used by this model.
 *
 * It is assumed to be used by this model if they are its children in the MessagePart tree.
 *
 * @property {Layer.Core.MessagePart[]}
 */
MessageTypeModel.prototype.childParts = null;

/**
 * Message Type Models that are directly used by this model.
 *
 * It is assumed to be used by this model if they are its children in the MessagePart tree.
 *
 * > *Note*
 * >
 * > childModels is *not* initialized if creating a model without a Message (even if you later call `generateMessage()`)
 *
 * @property {Layer.Core.MessageTypeModel[]}
 */
MessageTypeModel.prototype.childModels = null;

/**
 * Custom data for your message.
 *
 * A Message Type View/Model pair would not be implemented to render custom data; it would instead be
 * designed to support exactly the properties they need.
 *
 * However, an app that is customizing someone else's Message Type View may want to add properties
 * to the model without modifying the Model Definition itself; Custom Data supports that task.
 *
 * Custom Data also is useful for sticking properties about your Model that are for use by your server
 * rather than by the UI.
 * For example, you might stick Product IDs into your Product Message so that when your server receives
 * a Product Message it has all the info needed to lookup the full details.
 *
 * @property {Object}
 */
MessageTypeModel.prototype.customData = null;

/**
 * Action object represents the Layer.MessageTypeModel.actionEvent and Layer.MessageTypeModel.actionData properties.
 *
 * Typically you would pass this into the Model constructor as:
 *
 * ```
 * new Model({
 *    action: {
 *       event: "event-name",
 *       data: {custom: "data"}
 *    }
 * });
 * ```
 *
 * @property {Object}
 */
MessageTypeModel.prototype.action = null;

/**
 * Action to trigger when user selects a UI representing this Message Type Model
 *
 * Actions are strings that are put into events and which are intercepted and
 * interpreted either by `<layer-message-viewer />` or by the app.
 *
 * @property {String}
 */
MessageTypeModel.prototype.actionEvent = '';

/**
 * Data to use when triggering the Layer.MessageTypeModel.actionEvent.
 *
 * Action Data is an arbitrary hash, and contains data specific to the action.
 * This can be used to provide an alternate url to open from the one shown in a Link Message.
 * This can be used to provide a product-id to buy if showing a Product with an Image Message instead of a Product Message.
 * This can be used to provide the properties used by the action where the values in the model itself aren't suitable/available.
 *
 * @property {Object}
 */
MessageTypeModel.prototype.actionData = null;

/**
 * Root Part defining this Model
 *
 * @property {Layer.Core.MessagePart}
 */
MessageTypeModel.prototype.part = null;

/**
 * The role of this model.
 *
 * The role is defined by the MessagePart for this Model, and
 * determines what this Model means to its Parent Model in the Model tree.
 *
 * @property {String}
 */
MessageTypeModel.prototype.role = null;

/**
 * Stores all user responses which can be accessed using `getResponse` or `getResponses`
 *
 * ```
 * console.log(model.responses.getResponse(identityId, 'selection');
 * > 'brain-eating-musically-inclined-zombie'
 * ```
 *
 * @property {Layer.Core.MessageTypeResponseSummaryModel}
 */
MessageTypeModel.prototype.responses = null;

/**
 * The requested UI Component name for rendering this model.
 *
 * This property is set from the static `messageRenderer` property provided by most Models.
 *
 * Some models may need this value to be dynamically looked up instead of static:
 *
 * ```
 * __getCurrentMessageRenderer() {
 *   if (this.xxx) {
 *     return 'view1';
 *   else {
 *     return 'view2';
 *   }
 * }
 * ```
 *
 * @property {String}
 */
MessageTypeModel.prototype.currentMessageRenderer = '';
MessageTypeModel.prototype.currentMessageRendererExpanded = '';

/**
 * Sender of the Message Model
 *
 * @property {Layer.Core.Identity} messageSender
 */
MessageTypeModel.prototype.messageSender = null;

/**
 * Time the Message was sent.
 *
 * Note that a locally created Layer.Core.Message.sentAt will have a `sentAt` value even
 * though its not yet sent; this is so that any rendering code doesn't need
 * to account for `null` values.  Sending the Message may cause a slight change
 * in the `sentAt` value.
 *
 * @property {Date} messageSentAt
 */
MessageTypeModel.prototype.messageSentAt = null;

/**
 * Read/delivery State of all participants.
 *
 * This is an object containing keys for each participant,
 * and a value of:
 *
 * * Layer.Constants.RECEIPT_STATE.SENT
 * * Layer.Constants.RECEIPT_STATE.DELIVERED
 * * Layer.Constants.RECEIPT_STATE.READ
 * * Layer.Constants.RECEIPT_STATE.PENDING
 *
 * @property {Object}
 */
MessageTypeModel.prototype.messageRecipientStatus = null;

/**
 * Get the label for this item type.
 *
 * See each model's `LabelSingular` static property for name or to customize that name.
 *
 * @readonly
 * @property {String} [typeLabel]
 */
MessageTypeModel.prototype.typeLabel = '';

/**
 * The expression to use for setting the notification title.
 *
 * This title is used when sending a notification with your message.
 *
 * Set this with a template, where `this` refers to the MessageTypeModel instance
 * that uses this.  Customize it with:
 *
 * ```
 * Layer.Core.MessageTypeModel.NotificationTitle = 'Message Received from ${messageSender}';
 * Layer.Core.MessageTypeModel.NotificationTitle = '${messageSender} sent ${title}';
 * ```
 *
 * > *Note*
 * > While `${value}` is accepted, this does *not* use javascript's template string; `${expression}` is *not* supported
 *
 * See {@link #getNotification} for usage details.
 *
 * @property {String} NotificationTitle
 * @static
 */
MessageTypeModel.NotificationTitle = 'New Message from ${messageSender}'; // eslint-disable-line no-template-curly-in-string

/**
 * The MIME Type that this Model generates and for which this model will be instantiated.
 *
 * @static
 * @property {String} [MIMEType=]
 * @abstract
 */
MessageTypeModel.MIMEType = '';

/**
 * The UI Component to render this model
 *
 * @static
 * @property {String} [messageRenderer=]
 * @abstract
 */
MessageTypeModel.messageRenderer = '';

MessageTypeModel.prefixUUID = 'layer:///MessageTypeModels/';
MessageTypeModel._supportedEvents = [

  /**
   * A property of this model has changed.
   *
   * ```
   * model.on('message-type-model:change', function(evt) {
   *    var responseChanges = evt.getChangesFor('responses');
   *    responseChanges.forEach(change => console.log(change.propertyName + " has changed from ', change.oldValue, ' to ', change.newValue);
   *    }
   * });
   * ```
   *
   * @event
   * @param {Layer.Core.LayerEvent} evt
   */
  'message-type-model:change',

  /**
   * Any event used to customize the behavior of a Message Type Model.
   *
   * @event
   * @param {Layer.Core.LayerEvent} evt
   */
  'message-type-model:customization',

  /**
   * Any event used to customize the notification sent when sending a Message
   * representing this model.
   *
   * ```
   * model.on('message-type-model:notification', function(evt) {
   *    if (evt.notification.title.length > 50) evt.notification.title = 'Frodo is a Dodo';
   *    if (evt.notification.text.length < 10) evt.notification.text += ' and furthermore, Frodo is a Dodo';
   * });
   * ```
   *
   * @event
   * @param {Layer.Core.LayerEvent} evt
   */
  'message-type-model:notification',
].concat(Root._supportedEvents);
Root.initClass.apply(MessageTypeModel, [MessageTypeModel, 'MessageTypeModel', Core]);
module.exports = MessageTypeModel;
