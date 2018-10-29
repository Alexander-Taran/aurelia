import { IDisposable, IServiceLocator } from '@aurelia/kernel';
import { INode } from '../dom';
import { IBindScope, LifecycleState } from '../lifecycle';
import { LifecycleFlags, IScope } from '../observation';
import { hasBind, hasUnbind, IsBindingBehavior, StrictAny } from './ast';
import { IBinding } from './binding';
import { IConnectableBinding } from './connectable';
import { DelegationStrategy, IEventManager } from './event-manager';

export interface Listener extends IConnectableBinding {}
export class Listener implements IBinding {
  public $nextBind: IBindScope = null;
  public $prevBind: IBindScope = null;

  public $state: LifecycleState = LifecycleState.none;

  public $scope: IScope;

  private handler: IDisposable;

  constructor(
    public targetEvent: string,
    public delegationStrategy: DelegationStrategy,
    public sourceExpression: IsBindingBehavior,
    public target: INode,
    public preventDefault: boolean,
    private eventManager: IEventManager,
    public locator: IServiceLocator
  ) { }

  public callSource(event: Event): ReturnType<IsBindingBehavior['evaluate']> {
    const overrideContext = this.$scope.overrideContext;
    overrideContext['$event'] = event;

    const result = this.sourceExpression.evaluate(LifecycleFlags.mustEvaluate, this.$scope, this.locator);

    delete overrideContext['$event'];

    if (result !== true && this.preventDefault) {
      event.preventDefault();
    }

    return result;
  }

  public handleEvent(event: Event): void {
    this.callSource(event);
  }

  public $bind(flags: LifecycleFlags, scope: IScope): void {
    if (this.$state & LifecycleState.isBound) {
      if (this.$scope === scope) {
        return;
      }

      this.$unbind(flags | LifecycleFlags.fromBind);
    }
    // add isBinding flag
    this.$state |= LifecycleState.isBinding;

    this.$scope = scope;

    const sourceExpression = this.sourceExpression;
    if (hasBind(sourceExpression)) {
      sourceExpression.bind(flags, scope, this);
    }

    this.handler = this.eventManager.addEventListener(
      this.target,
      this.targetEvent,
      this,
      this.delegationStrategy
    );

    // add isBound flag and remove isBinding flag
    this.$state |= LifecycleState.isBound;
    this.$state &= ~LifecycleState.isBinding;
  }

  public $unbind(flags: LifecycleFlags): void {
    if (!(this.$state & LifecycleState.isBound)) {
      return;
    }
    // add isUnbinding flag
    this.$state |= LifecycleState.isUnbinding;

    const sourceExpression = this.sourceExpression;
    if (hasUnbind(sourceExpression)) {
      sourceExpression.unbind(flags, this.$scope, this);
    }

    this.$scope = null;
    this.handler.dispose();
    this.handler = null;

    // remove isBound and isUnbinding flags
    this.$state &= ~(LifecycleState.isBound | LifecycleState.isUnbinding);
  }
  // tslint:disable:no-empty no-any
  public observeProperty(obj: StrictAny, propertyName: StrictAny): void { }
  public handleChange(newValue: any, previousValue: any, flags: LifecycleFlags): void { }
  // tslint:enable:no-empty no-any
}
