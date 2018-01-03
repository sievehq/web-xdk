/**
 * The Layer Message List widget renders a scrollable, pagable list of Layer.UI.components.MessageListPanel.Item widgets.
 *
 * This is designed to go inside of the Layer.UI.Conversation widget.
 *
 * This Component has three named templates:
 *
 * * `layer-message-item-sent`: Rendering for Messages sent by the owner of this Session
 * * `layer-message-item-received`: Rendering for Messages sent by other users
 * * `layer-message-item-status`: Rendering for Messages sent as Status Messages
 *
 * Messages are organized into sets where a set starts with the first message from a given user, and ends when either
 * a different user sends a Message, or a long enough pause occurs.  Each Message will have firstInSeries/lastInSeries properties,
 * and these need to be maintained as new Messages are loaded, deleted, etc...
 *
 * ## Customization
 *
 * The `replaceableContent` property supports most basic customization.
 *
 * Each Layer.UI.components.MessageListPanel.Item can be customized this way as documented on the Item page.
 *
 * Any `replaceableContent` setup provided to the List will be passed onto the items.  In addition, the following
 * replaceableContent is supported for this list:
 *
 * * `emptyNode`: Shown to indicate that there are no messages in this conversation
 * * `endOfResultsNode`: Shown to indicate that the first message in the conversation has been reached; may be used to
 *   render something like "Welcome to the start of the Conversation"
 * * `loadIndicator`: Shown to indicate that we are fetching more messages from the server
 *
 * Typically these are all set on the Layer.UI.components.ConversationView which passes them down to this List:
 *
 * ```
 * conversationView.replaceableContent = {
 *     emptyNode: function(listWidget) {
 *        var div = document.createElement('div');
 *        div.innerHTML = 'if you want to see the messages you first need to have messages!';
 *        return div;
 *     }
 * };
 * ```
 *
 * ## Advanced Customization
 *
 * To enhance the Message List widget with new properties, methods and capabilities, you have can add Mixins.
 *
 *
 * The following example adds a search bar to the Message List
 *
 * ```
 * Layer.UI.init({
 *   mixins: {
 *     'layer-message-list': {
 *       properties: {
 *         searchText: {
 *           value: '',
 *           set: function(value) {
 *             this.nodes.searchBar.value = value;
 *             this._runSearch();
 *           },
 *           get: function() {
 *             return this.nodes.searchBar.value;
 *           }
 *         }
 *       },
 *       methods: {
 *         // When the widget is created, setup/initialize our custom behaviors
 *         onCreate: function() {
 *           this.nodes.searchBar = document.createElement('input');
 *           this.nodes.searchBar.classList.add('custom-search-bar');
 *           this.nodes.searchBar.addEventListener('change', this._runSearch.bind(this));
 *           this.insertBefore(this.nodes.searchBar, this.nodes.listMeta.firstChild);
 *         },
 *
 *
 *         // Whenver any messages are added/removed/changed, rerun our search
 *         onRerender: function() {
 *           if (this.searchText) this._runSearch();
 *         },
 *
 *         // Search is run whenver the user changes the search text, app changes the search text,
 *         // or new messages arrive that need to be searched
 *         _runSearch() {
 *           var searchText = this.searchText;
 *           Array.prototype.slice.call(this.childNodes).forEach(function(messageItem) {
 *             if (messageItem._isListItem) {
 *               var message = messageItem.item;
 *               if (message.parts[0].body.indexOf(searchText) === -1) {
 *                 messageItem.classList.remove('search-matches');
 *               } else {
 *                 messageItem.classList.add('search-matches');
 *               }
 *             }
 *           });
 *         }
 *       }
 *     }
 *   }
 * });
 * ```
 *
 * @class Layer.UI.components.MessageListPanel.List
 * @extends Layer.UI.Component
 *
 * @mixin Layer.UI.mixins.HasQuery
 * @mixin Layer.UI.mixins.EmptyList
 * @mixin Layer.UI.mixins.List
 * @mixin Layer.UI.mixins.ListLoadIndicator
 * @mixin Layer.UI.mixins.QueryEndIndicator
 */
import Util from '../../../../util';
import UI from '../../../base';
import MessageHandlers from '../../../handlers/message/message-handlers';
import { isInBackground as IsInBackground } from '../../../utils';
import { registerComponent } from '../../component';
import List from '../../../mixins/list';
import HasQuery from '../../../mixins/has-query';
import EmptyList from '../../../mixins/empty-list';
import ListLoadIndicator from '../../../mixins/list-load-indicator';
import QueryEndIndicator from '../../../mixins/query-end-indicator';
import '../layer-message-item-sent/layer-message-item-sent';
import '../layer-message-item-received/layer-message-item-received';
import '../layer-message-item-status/layer-message-item-status';
import '../layer-start-of-conversation/layer-start-of-conversation';

// Mandatory delay between loading one page and the next.  If user is scrolling too fast, they'll have to wait at least (2) seconds.
const PAGING_DELAY = 2000;

registerComponent('layer-message-list', {
  mixins: [List, HasQuery, EmptyList, ListLoadIndicator, QueryEndIndicator],
  properties: {

    /**
     * Supplemental property which helps drive the welcome message.
     *
     * This property is not used by this Component, but any child components (such as those added
     * using `replaceableContent` AND which have a `layer-id` attribute will have this value passed to them
     * whenever it is changed.  Typically this is used to provide the Layer.Core.Conversation to the
     * `<layer-start-of-conversation />` widget.
     *
     * @property {Layer.Core.Conversation}
     */
    conversation: {
      propagateToChildren: true,
    },

    /**
     * @inheritdoc Layer.UI.components.ConversationView#dateRenderer
     *
     * @property {Function} [dateRenderer=null]
     * @property {Date} dateRenderer.date
     * @property {String} dateRenderer.return
     */
    dateRenderer: {},

    /**
     * @inheritdoc Layer.UI.components.ConversationView#messageStatusRenderer
     *
     * @property {Function} [messageStatusRenderer=null]
     * @property {Layer.Core.Message} messageStatusRenderer.message
     * @property {String} messageStatusRenderer.return
     */
    messageStatusRenderer: {},

    /**
     * @inheritdoc Layer.UI.components.ConversationView#dateFormat
     *
     * @property {Object} [dateFormat=]
     * @property {Object} [dateFormat.today={hour: 'numeric', minute: 'numeric'}]
     * @property {Object} [dateFormat.week={ weekday: 'short', hour: 'numeric', minute: 'numeric' }]
     * @property {Object} [dateFormat.older={ month: 'short', year: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }]
     * @property {Object} [dateFormat.default={ month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric' }]
     */
    dateFormat: {
      value: {
        today: { hour: 'numeric', minute: 'numeric' },
        week: { weekday: 'short', hour: 'numeric', minute: 'numeric' },
        older: { month: 'short', year: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' },
        default: { month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric' },
      },
    },

    /**
     * @inheritdoc Layer.UI.components.ConversationView#getMenuOptions
     *
     * @property {Function} getMenuOptions
     * @property {Layer.Core.Message} getMenuOptions.message
     * @property {Object[]} getMenuOptions.return
     */
    getMenuOptions: {
      type: Function,
    },

    /**
     * Disable read receipts and other behaviors; typically used when the widget has been hidden from view.
     *
     * ```
     * widget.disable = true;
     * ```
     *
     * @property {Boolean} disable
     */
    disable: {
      set(value) {
        if (!value) {
          this.properties.stuckToBottom = true;
          this.scrollTo(this.scrollHeight - this.clientHeight);
          this._checkVisibility();
        }
      },
    },

    /**
     * If the user scrolls within this many screen-fulls of the top of the list, page the Query.
     *
     * If value is 0, will page once the user reaches the top.  If the value is 0.5, will page once the user
     * reaches a `scrollTop` of 1/2 `clientHeight`.
     *
     * @property {Number} [screenFullsBeforePaging=2.0]
     */
    screenFullsBeforePaging: {
      value: 2.0,
    },

    /**
     * Note that we provide default definitions of replaceable content here rather than in the
     * message item; this could move in the future.
     *
     * @property replaceableContent
     */
    replaceableContent: {
      value: {
        messageRowLeftSide: function messageRowLeftSide(widget) {
          const item = widget.item;
          const model = item.createModel();
          if (model && model.constructor.messageRenderer === 'layer-carousel-message-view') return null;

          if (item.sender.sessionOwner) {
            return null;
          } else {
            const div = document.createElement('div');
            div.classList.add('layer-replaceable-inner');
            const avatar = document.createElement('layer-avatar');
            avatar.size = 'small';
            avatar.showPresence = false;
            avatar.setAttribute('layer-id', 'avatar');
            div.appendChild(avatar);
            return div;
          }
        },
        messageRowRightSide: function messageRowRightSide(widget) {
          const item = widget.item;
          const model = item.createModel();
          if (model && model.constructor.messageRenderer === 'layer-carousel-message-view') return null;

          const div = document.createElement('div');
          div.classList.add('layer-replaceable-inner');
          if (item.sender.sessionOwner) {
            const avatar = document.createElement('layer-avatar');
            avatar.size = 'small';
            avatar.showPresence = false;
            avatar.setAttribute('layer-id', 'avatar');
            div.appendChild(avatar);
          }
          const menu = document.createElement('layer-menu-button');
          menu.setAttribute('layer-id', 'menuButton');
          div.appendChild(menu);
          return div;
        },
        messageRowFooter: function messageRowFooter(widget) {
          const item = widget.item;
          const parentNode = document.createElement('div');
          parentNode.classList.add('layer-replaceable-inner');
          if (item.sender.sessionOwner) {
            const status = document.createElement('layer-message-status');
            status.setAttribute('layer-id', 'status');
            parentNode.appendChild(status);
          }
          const date = document.createElement('layer-date');
          date.setAttribute('layer-id', 'date');
          date.dateFormat = this.dateFormat;
          parentNode.appendChild(date);
          return parentNode;
        },
        messageRowHeader: function messageRowHeader(widget) {
          if (!widget.item.sender.sessionOwner) {
            const div = document.createElement('div');
            div.setAttribute('layer-id', 'sender');
            div.classList.add('layer-sender-name');
            return div;
          }
        },
      },
    },
  },
  methods: {
    // Lifecycle method sets up intial properties and events
    onCreate() {
      if (!this.id) this.id = Util.generateUUID();

      // Init some local props
      this.properties.lastPagedAt = 0;
      this.properties.isSelfScrolling = false;
      this.properties.stuckToBottom = true;
      this.properties._checkVisibilityBound = this._checkVisibility.bind(this);

      window.addEventListener('focus', this.properties._checkVisibilityBound);
    },

    /**
     * Cleanup all pointers to self created by registering event handlers.
     *
     * @method onDestroy
     * @private
     */
    onDestroy() {
      window.removeEventListener('focus', this.properties._checkVisibilityBound);
    },

    /**
     * Tests to see if we should load a new page of data.
     *
     * 1. Tests scrollTop to see if we are close enough to the top
     * 2. Tests if we are already loading that page of data
     *
     * @method _shouldPage
     * @return {Boolean}
     * @private
     */
    _shouldPage() {
      const pagingHeight = Math.max(this.clientHeight, 300) * this.screenFullsBeforePaging;
      return this.scrollTop <= pagingHeight && this.scrollHeight > this.clientHeight + 1 && !this.isDataLoading;
    },

    /**
     * Handler is called whenever the list is scrolled.
     *
     * Scrolling is caused by user activity, OR by setting the `scrollTop`.
     * Typically, we want to stay `stuckToButton` so that any time new Messages arrive,
     * we scroll to the bottom to see them.  Any user scrolling however may disable that behavior.
     *
     * @method _handleScroll
     * @private
     */
    _handleScroll: {
      mode: registerComponent.MODES.OVERWRITE,
      value() {
        if (this.properties.isSelfScrolling) return;

        // If the user has scrolled within screenFullsBeforePaging of the top of the page...
        // and if the page has enough contents to actually
        // be scrollable, page the Messages.
        if (this._shouldPage() && !this.properties.delayedPagingTimeout) {
          if (this.properties.lastPagedAt + PAGING_DELAY < Date.now()) {
            if (!this.query.isFiring) {
              this.query.update({ paginationWindow: this.query.paginationWindow + 50 });
              this.isDataLoading = this.properties.query.isFiring;
            }
          } else if (!this.properties.delayedPagingTimeout) {
            // User is scrolling kind of fast, lets slow things down a little
            this.properties.delayedPagingTimeout = setTimeout(() => {
              this.query.update({ paginationWindow: this.query.paginationWindow + 50 });
              this.isDataLoading = this.properties.query.isFiring;
              this.properties.delayedPagingTimeout = 0;
            }, 500);
          }
        }

        // If we have scrolled to the bottom/away from bottom, update stuckToBottom.
        const stuckToBottom = this.scrollHeight - 10 <= this.clientHeight + this.scrollTop;
        if (stuckToBottom !== this.properties.stuckToBottom && !this.properties.inPagedData) {
          this.properties.stuckToBottom = stuckToBottom;
        }

        // Trigger checks on visibility to update read state
        this._checkVisibility();
      },
    },

    /**
     * Scroll the list to the specified Y position in pixels.
     *
     * Will call _checkVisibility() when done.
     *
     * ```
     * widget.scrollTo(500);
     * ```
     *
     * See also:
     *
     * * #scrollToItem
     * * #animatedScrollTo
     *
     * @method scrollTo
     * @param {Number} position
     */
    scrollTo: {
      mode: registerComponent.MODES.OVERWRITE,
      value(position) {
        if (position === this.scrollTop) return;
        this.properties.isSelfScrolling = true;
        this.scrollTop = position;
        setTimeout(() => {
          this.properties.isSelfScrolling = false;
          this._checkVisibility();
        }, 200);
      },
    },

    /**
     * Scrolls the list to the specified Y position.
     *
     * Will call _checkVisibility() when done.
     *
     * ```
     * widget.animatedScrollTo(500);
     * ```
     *
     * @method animatedScrollTo
     * @param {Number} position            Pixels from top of list to scroll to
     * @param {Number} [animateSpeed=200]  Number of miliseconds of animated scrolling; 0 for no animation
     * @param {Function} [animateCallback] Function to call when animation completes
     */
    animatedScrollTo: {
      mode: registerComponent.MODES.OVERWRITE,
      value(position, animateSpeed = 200, animateCallback) {
        if (position === this.scrollTop) return;
        this.properties.isSelfScrolling = true;
        if (this.properties.cancelAnimatedScroll) this.properties.cancelAnimatedScroll();
        const cancel = this.properties.cancelAnimatedScroll = UI.animatedScrollTo(this, position, animateSpeed, () => {
          // Wait for any onScroll events to trigger before we clear isSelfScrolling and procede
          setTimeout(() => {
            if (cancel !== this.properties.cancelAnimatedScroll) return;
            this.properties.cancelAnimatedScroll = null;

            this.properties.isSelfScrolling = false;
            this._checkVisibility();
            if (animateCallback) animateCallback();
          }, 100);
        });
      },
    },

    /**
     * Check which Messages are fully visible, and mark them as Read.
     *
     * TODO PERFORMANCE: Should be able to skip to the visible items and near-visible items without iterating over entire list
     *
     * NOTE: Only mark messages as read if the document has focus.  Just being visible but not in focus does not give us
     * sufficient cause to assume the user has read it.
     *
     * TODO: At some point we may need to customize whether document.hasFocus() is required; in particular, this could cause problems for anyone
     * running in an iFrame.  Is top.document.hasFocus() a suitable solution, or are there scenarios where top might not even be accessable due to
     * being a different domain?
     *
     * @method _checkVisibility
     * @private
     */
    _checkVisibility() {
      if (IsInBackground() || this.disable) return;

      // The top that we can see is marked by how far we have scrolled.
      const visibleTop = this.scrollTop;

      // The bottom that we can see is marked by how far we have scrolled plus the height of the panel.
      const visibleBottom = this.scrollTop + this.clientHeight;
      const children = Array.prototype.slice.call(this.childNodes);
      children.forEach((child) => {
        const childOffset = child.offsetTop - this.offsetTop;
        if (childOffset >= visibleTop && childOffset + child.clientHeight <= visibleBottom) {
          if (child.properties && child.properties.item && !child.properties.item.isRead) {
            // TODO: Use a scheduler rather than many setTimeout calls
            setTimeout(() => this._markAsRead(child), UI.settings.markReadDelay);
          }
        }
      }, this);
    },

    /**
     * Mark a the Message associated with this item as read.
     *
     * This method validates that the Message flagged as ready to be read by #_checkVisibility is
     * in fact still fully visible after the delay.
     *
     * @method _markAsRead
     * @private
     * @param {Layer.UI.components.MessageListPanel.Item} child
     */
    _markAsRead(child) {
      if (IsInBackground() || this.disable) return;

      const visibleTop = this.scrollTop;
      const visibleBottom = this.scrollTop + this.clientHeight;
      const childOffset = child.offsetTop - this.offsetTop;
      if (childOffset >= visibleTop && childOffset + child.clientHeight <= visibleBottom) {
        child.properties.item.isRead = true;
      }
    },

    /**
     * Append a Message to the document fragment, updating the previous messages' lastInSeries property as needed.
     *
     * @method _generateItem
     * @parameter {Layer.Core.Message} message
     * @returns {Layer.UI.components.MessageListPanel.Item}
     * @private
     */
    _generateItem(message) {
      const handler = MessageHandlers.getHandler(message, this);
      if (handler) {
        const rootPart = message.getPartsMatchingAttribute({ role: 'root' })[0];
        let type;
        if (this._isStatusMessage(rootPart, message)) {
          type = 'layer-message-item-status';
        } else if (message.sender.sessionOwner) {
          type = 'layer-message-item-sent';
        } else {
          type = 'layer-message-item-received';
        }
        const messageWidget = document.createElement(type);
        messageWidget.id = this._getItemId(message.id);
        messageWidget.dateRenderer = this.dateRenderer;
        messageWidget.messageStatusRenderer = this.messageStatusRenderer;
        if (this.dateFormat) messageWidget.dateFormat = this.dateFormat;
        messageWidget._contentTag = handler.tagName;
        messageWidget.item = message;
        messageWidget.getMenuOptions = this.getMenuOptions;
        if (this.query.pagedToEnd && this.query.data.indexOf(message) === this.query.data.length - 1) {
          messageWidget.classList.add('layer-first-message-of-conversation');
        }
        return messageWidget;
      } else {
        return null;
      }
    },

    /**
     * Should the provided message with the specified Root Message Part be treated as a Status Message?
     *
     * If there is no rootPart, then its _not_ following Message Type Model conventions, and is therefore
     * not a Status Message.
     *
     * @param {Layer.Core.MessageTypeModel} rootPart
     * @param {Layer.Core.Message} message
     */
    _isStatusMessage(rootPart, message) {
      if (!rootPart) return false;
      return UI.statusMimeTypes.indexOf(rootPart.mimeType) !== -1;
    },

    /**
     * Are the two Messages in the same Group?
     *
     * See Layer.UI.settings.messageGroupTimeSpan to adjust the definition of Same Group.
     *
     * @method _inSameGroup
     * @private
     * @param {Layer.UI.Component} message-item1
     * @param {Layer.UI.Component} message-item2
     * @returns {Boolean}
     */
    _inSameGroup(m1, m2) {
      if (!m1 || !m2) return false;
      if (m1.tagName !== m2.tagName) return false;
      const message1 = m1.item;
      const message2 = m2.item;
      const diff = Math.abs(message1.sentAt.getTime() - message2.sentAt.getTime());
      return message1.sender === message2.sender && diff < Layer.UI.settings.messageGroupTimeSpan;
    },

    /**
     * Whenever new message items are added to the list, we need to assign lastInSeries and firstInSeries values to them,
     * as well as update those values in nearby message items.
     *
     * @method _processAffectedWidgetsCustom
     * @private
     * @param {Layer.UI.components.MessageListPanel.Item[]} widgets
     * @param {Number} firstIndex - Index in the listData array of the first item in the widgets array
     * @param {Boolean} isTopItemNew - If the top item is index 0 and its a new item rather than an "affected" item, this is true.
     */
    _processAffectedWidgetsCustom(widgets, firstIndex, isTopItemNew) {
      if (widgets.length === 0) return;
      if (isTopItemNew) widgets[0].firstInSeries = true;
      for (let i = 1; i < widgets.length; i++) {
        const sameGroup = this._inSameGroup(widgets[i - 1], widgets[i]);
        widgets[i].firstInSeries = !sameGroup;
        widgets[i - 1].lastInSeries = !sameGroup;
      }
      if (!widgets[widgets.length - 1].nextSibling) widgets[widgets.length - 1].lastInSeries = true;
    },

    // See List mixin docs
    _renderResetData: {
      mode: registerComponent.MODES.AFTER,
      value: function _renderResetData(evt) {
        this.properties.stuckToBottom = true;
        this.properties.lastPagedAt = 0;
        this.properties.isSelfScrolling = false;
      },
    },

    // See List mixin docs
    _renderWithoutRemovedData: {
      mode: registerComponent.MODES.OVERWRITE,
      value(evt) {
        this.properties.listData = [].concat(this.properties.query.data).reverse();

        const messageWidget = this.querySelector('#' + this._getItemId(evt.target.id));
        if (messageWidget) this.removeChild(messageWidget);

        const removeIndex = this.properties.listData.length - evt.index; // Inverted for reverse order
        const affectedItems = this.properties.listData.slice(Math.max(0, removeIndex - 3), removeIndex + 3);
        this._gatherAndProcessAffectedItems(affectedItems, false);
      },
    },

    // See List mixin docs
    _renderInsertedData: {
      mode: registerComponent.MODES.OVERWRITE,
      value(evt) {
        if (this.properties.appendingMore) {
          if (!this.properties.insertEvents) this.properties.insertEvents = [];
          this.properties.insertEvents.push(evt);
          return;
        }
        const oldListData = this.properties.listData;
        this.properties.listData = [].concat(this.properties.query.data).reverse();

        const insertIndex = oldListData.length - evt.index; // Inverted for reverse order
        const isTopItemNew = insertIndex === 0;

        const affectedItems = this.properties.listData.slice(Math.max(0, insertIndex - 3), insertIndex + 4);
        const fragment = this._generateFragment([evt.target]);
        if (insertIndex < oldListData.length) {
          const insertBeforeNode = affectedItems.length > 1 ?
            this.querySelector('#' + this._getItemId(oldListData[insertIndex].id)) : null;
          this.insertBefore(fragment, insertBeforeNode);
        } else {
          this.appendChild(fragment);
        }
        this._gatherAndProcessAffectedItems(affectedItems, isTopItemNew);
        this._updateLastMessageSent();
        if (this.properties.stuckToBottom) {
          setTimeout(() => this.animatedScrollTo(this.scrollHeight - this.clientHeight), 0);
        } else {
          this._checkVisibility();
        }
        if (!evt.inRender) this.onRerender();
      },
    },

    /**
     * The last message sent by the session owner should show some pending/read-by/etc... status.
     *
     * Other messages may also do this, but adding the `layer-last-message-sent` css class makes it easy
     * to conditionally show status only for the last sent message.
     *
     * TODO: Review if a CSS :last-child could isolate last message sent from last message received, and be used for easily styling this.
     *
     * @method _updateLastMessageSent
     * @private
     */
    _updateLastMessageSent() {
      for (let i = this.properties.listData.length - 1; i >= 0; i--) {
        if (this.properties.listData[i].sender.sessionOwner) {
          const item = this.querySelector('#' + this._getItemId(this.properties.listData[i].id));
          if (item && !item.classList.contains('layer-last-message-sent')) {
            this.querySelectorAllArray('.layer-last-message-sent').forEach((node) => {
              node.classList.remove('layer-last-message-sent');
            });
            item.classList.add('layer-last-message-sent');
          }
          break;
        }
      }
    },

    /**
     * Identify the message-item that is fully visible and at the top of the viewport.
     *
     * We use this before paging in new data so that we know which message should still
     * be at the top after we insert new messages at the top, and must compensate our `scrollTop`
     * accordingly.
     *
     * @method _findFirstVisibleItem
     * @private
     */
    _findFirstVisibleItem() {
      const visibleTop = this.scrollTop;
      const visibleBottom = this.scrollTop + this.clientHeight;
      const children = Array.prototype.slice.call(this.childNodes);
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const childOffset = child.offsetTop - this.offsetTop;
        if (childOffset >= visibleTop && childOffset + child.clientHeight <= visibleBottom) {
          if (child.properties && child.properties.item) {
            return child;
          }
        }
      }
      return null;
    },

    /**
     * Render a new page of data received from the Query.
     *
     * @method _renderPagedData
     * @private
     */
    _renderPagedData: {
      mode: registerComponent.MODES.OVERWRITE,
      value(evt) {
        if (evt.data.length === 0) {
          this.isDataLoading = this.properties.query.isFiring;
          if (this.query.pagedToEnd) {
            const firstItem = this.querySelectorAllArray('.layer-message-item')[0];
            if (firstItem && firstItem.item && firstItem.item === this.query.data[this.query.data.length - 1]) {
              firstItem.classList.add('layer-first-message-of-conversation');
            }
          }
          this._renderPagedDataDone([], null, evt);
          return;
        }

        this.properties.inPagedData = true;

        // Set this so that if the user is clinging to the scrollbar forcing it to stay at the top,
        // we know we just paged and won't page again.
        this.properties.lastPagedAt = Date.now();

        // Get both the query data and the event data
        const oldListData = this.properties.listData;
        this.properties.listData = [].concat(this.properties.query.data).reverse();
        const newData = [].concat(evt.data).reverse();

        // Get the affected items
        let affectedItems = [].concat(newData);
        let fragment;
        if (oldListData.length) affectedItems = affectedItems.concat(oldListData.slice(0, 3));


        // Append only a few items at a time, with pauses to keep browser running smoothly.
        // Don't append anything to the document until its all generated
        // TODO: This sucks.  For 100 items, it takes 5 iterates of 20ms each, so it adds 100ms lag to render,
        // and the only good news is that this 100ms lag results in performance of the rest of the browser not degrading.
        const appendMore = function appendMore() {
          if (!this.query || this.query.isDestroyed) return;
          this.properties.appendingMore = true;
          const processItems = newData.splice(0, 20).filter(item => !item.isDestroyed);
          fragment = this._generateFragment(processItems, fragment);
          if (newData.length) {
            setTimeout(() => appendMore.call(this), 20);
          } else {
            this.properties.appendingMore = false;
            Util.defer(() => this._renderPagedDataDone(affectedItems, fragment, evt));
          }
        }.bind(this);
        appendMore();
      },
    },

    /**
     * After we have rendered the newly paged in messages, some post processing is needed.
     *
     * 1. Call processAffectedWidgets
     * 2. Scroll to maintain an appropriate position
     * 3. Insert the document fragment into our widget
     * 4. Check visibility on newly rendered items
     *
     * @method _renderPagedDataDone
     * @private
     */
    _renderPagedDataDone(affectedItems, fragment, evt) {
      if (!fragment) return; // called without fragment to trigger mixin versions of _renderPagedDataDone
      if (this.properties._internalState.onDestroyCalled) return;

      // Find the nodes of all affected items in both the document and the fragment,
      // and call processAffectedWidgets on them
      if (affectedItems.length) {
        const affectedWidgetsQuery = '#' + affectedItems.map(message => this._getItemId(message.id)).join(', #');
        let affectedWidgets = this.querySelectorAllArray(affectedWidgetsQuery);
        if (fragment) {
          const fragmentWidgets = Array.prototype.slice.call(fragment.querySelectorAll(affectedWidgetsQuery));
          affectedWidgets = fragmentWidgets.concat(affectedWidgets);
        }
        try {
          // When paging new data, top item should always be new
          this._processAffectedWidgets(affectedWidgets, true);
        } catch (e) {
          console.error(e);
        }
      }

      const firstVisibleItem = this._findFirstVisibleItem();
      const initialOffset = firstVisibleItem ?
        firstVisibleItem.offsetTop - this.offsetTop - this.scrollTop : 0;

      // Now that DOM manipulation is completed,
      // we can add the document fragments to the page
      const nextItem = this.nodes.listMeta.nextSibling;
      this.insertBefore(fragment, nextItem);

      // TODO PERFORMANCE: We should not need to do this as we page UP; very wasteful
      this._updateLastMessageSent();

      this.isDataLoading = this.properties.query.isFiring;
      this._checkVisibility();
      if (!evt.inRender) this.onRerender();

      if (this.properties.insertEvents) this.properties.insertEvents.forEach(anEvt => this._renderInsertedData(anEvt));
      delete this.properties.insertEvents;

      // more than just lastMessage
      if (this.query.data.length > 1) {
        Util.defer(() => this._pagedDataDone(firstVisibleItem, evt, initialOffset));
      }

      // Fixes special case where first message is taller than the viewport,
      // also happens when listItem.beforeNode adds height.
      else if (this.properties.stuckToBottom) {
        this.onPagedDataDone(false);
        this.properties.inPagedData = false;
        // TODO: Add onPagedData(true) call
      }
    },

    /**
     * This method is called whenever the list finishes generating all of the Layer.UI.components.MessageListPanel.Item
     * for a new page of data.
     *
     * On finishing loading, it will:
     *
     * 1. Determine where it needs to scroll to (bottom or fistVisibleItem)
     * 2. Scroll to that position
     * 3. Wait for messages to finish asyc rendering such as fetching images from servers
     * 4. Rescroll to that position after all message heights are updated
     *
     * @method _pagedDataDone
     * @private
     * @param {Layer.UI.components.MessageListPanel.Item} firstVisibleItem   The first message that at the top of the view and fully visible
     * @param {Layer.Core.LayerEvent} evt   The Query change event that delivered the data
     * @param {Number} initialOffset    How far from the top of the Message List is that first fully visible item (so we can maintain that offset)
     */
    _pagedDataDone(firstVisibleItem, evt, initialOffset) {
      let needsPagedDataDone = true;

      if (this.properties.stuckToBottom) {
        // Get all Message Viewers that contain a ui node
        const uis = this.querySelectorAllArray('layer-message-viewer').map(card => card.nodes.ui).filter(ui => ui);

        // Gather all UIs that haven't yet finished allocating their height
        let unfinishedUIs = uis.filter(card => !card.isHeightAllocated);

        // If there are unfinished UIs, setup event handlers to detect when all messages are done
        if (unfinishedUIs.length) {
          this.onPagedDataDone(false);

          // Function determines if everything is resolved, and if so, calls onPagedDataDone(true)
          const onCardFinished = () => {
            unfinishedUIs = unfinishedUIs.filter(card => !card.isHeightAllocated);
            if (unfinishedUIs.length === 0) {
              this.removeEventListener('message-height-change', onCardFinished);
              setTimeout(() => this.onPagedDataDone(true), 10);
            }
          };

          // Listen for all Messages that have resolved their height
          this.addEventListener('message-height-change', onCardFinished);
          needsPagedDataDone = false;
        }
      }

      // If we are not stuck to the bottom, then just try and stay pinned to whatever the first visible item is
      // TODO: this doesn't yet use the height change events to make adjustments!!!
      else if (firstVisibleItem && evt.type === 'data' && evt.data.length !== 0) {
        this.scrollTo(firstVisibleItem.offsetTop - this.offsetTop - initialOffset);
      }

      // Is everything good? Well then call onPagedDataDone(true)
      if (needsPagedDataDone) {
        this.onPagedDataDone(true);
        this.properties.inPagedData = false;
      }
    },

    /**
     * Mixin Hook for when a page of messages has finished loading.
     *
     * Note that the `isDoneSizingContent` is significant if you need all of the Messages to finish allocating their height
     * before doing processing.  Messages adjust their height when fetching graphics asynchronously and do not yet know
     * the dimensions for those images.  Fixed height messages are typically cleaner to work with.
     *
     * @param {Boolean} isDoneSizingContent
     */
    onPagedDataDone(isDoneSizingContent) {
      if (this.properties.stuckToBottom) {
        this.scrollTo(this.scrollHeight - this.clientHeight);
      }
    },
  },
});
