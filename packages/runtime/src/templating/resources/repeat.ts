import { inject } from '@aurelia/kernel';
import { ForOfStatement } from '../../binding/ast';
import { Binding } from '../../binding/binding';
import { BindingContext, Scope } from '../../binding/binding-context';
import { getCollectionObserver } from '../../binding/observer-locator';
import { SetterObserver } from '../../binding/property-observation';
import { INode, IRenderLocation } from '../../dom';
import { IAttachLifecycle, IDetachLifecycle, AttachLifecycleFlags, LifecycleState } from '../../lifecycle';
import { LifecycleFlags, CollectionObserver, IBatchedCollectionSubscriber, IChangeSet, IObservedArray, IScope, ObservedCollection } from '../../observation';
import { bindable } from '../bindable';
import { ICustomAttribute, templateController } from '../custom-attribute';
import { IRenderable } from '../rendering-engine';
import { IView, IViewFactory } from '../view';

export interface Repeat<T extends ObservedCollection> extends ICustomAttribute, IBatchedCollectionSubscriber {}

@inject(IChangeSet, IRenderLocation, IRenderable, IViewFactory)
@templateController('repeat')
export class Repeat<T extends ObservedCollection = IObservedArray> {
  @bindable public items: T;

  public $scope: IScope;
  public $observers: { items: SetterObserver };

  public encapsulationSource: INode = null;
  public views: IView[] = [];
  public observer: CollectionObserver = null;
  public hasPendingInstanceMutation: boolean = false;

  public forOf: ForOfStatement;
  public local: string;

  constructor(
    public changeSet: IChangeSet,
    public location: IRenderLocation,
    public renderable: IRenderable,
    public factory: IViewFactory) { }

  public bound(flags: LifecycleFlags): void {
    let current = this.renderable.$bindableHead;
    while (current !== null) {
      if ((<Binding>current).target === this && (<Binding>current).targetProperty === 'items') {
        this.forOf = (<Binding>current).sourceExpression as ForOfStatement;
        break;
      }
      current = current.$nextBind;
    }
    this.local = this.forOf.declaration.evaluate(flags, this.$scope, null);

    this.processViews(null, flags);
    this.checkCollectionObserver();
  }

  public attaching(encapsulationSource: INode, flags: LifecycleFlags): void {
    const { views, location } = this;
    for (let i = 0, ii = views.length; i < ii; ++i) {
      const view = views[i];
      view.hold(location);
      view.$attach(encapsulationSource, flags);
    }
  }

  public detaching(flags: LifecycleFlags): void {
    const { views } = this;
    for (let i = 0, ii = views.length; i < ii; ++i) {
      const view = views[i];
      view.$detach(flags);
      view.release();
    }
  }

  public unbound(flags: LifecycleFlags): void {
    this.checkCollectionObserver();

    const { views } = this;
    for (let i = 0, ii = views.length; i < ii; ++i) {
      const view = views[i];
      view.$unbind(flags);
    }
  }

  // called by SetterObserver (sync)
  public itemsChanged(newValue: T, oldValue: T, flags: LifecycleFlags): void {
    this.checkCollectionObserver();
    this.processViews(null, flags | LifecycleFlags.updateTargetInstance);
  }

  // called by a CollectionObserver (async)
  public handleBatchedChange(indexMap: number[] | null): void {
    this.processViews(indexMap, LifecycleFlags.fromFlushChanges | LifecycleFlags.updateTargetInstance);
  }

  // if the indexMap === null, it is an instance mutation, otherwise it's an items mutation
  private processViews(indexMap: number[] | null, flags: LifecycleFlags): void {
    const views = this.views;
    if (this.$state & LifecycleState.isBound) {
      const { local, $scope, factory, forOf, items } = this;
      const oldLength = views.length;
      const newLength = forOf.count(items);
      if (oldLength < newLength) {
        views.length = newLength;
        for (let i = oldLength; i < newLength; ++i) {
          views[i] = factory.create();
        }
      } else if (newLength < oldLength) {
        for (let i = newLength, view = views[i]; i < oldLength; view = views[++i]) {
          view.release();
          view.$detach(LifecycleFlags.fromBindableHandler);
          view.$unbind(LifecycleFlags.fromBindableHandler);
        }
        views.length = newLength;
        if (newLength === 0) {
          return;
        }
      } else if (newLength === 0) {
        return;
      }

      if (indexMap === null) {
        forOf.iterate(items, (arr, i, item) => {
          const view = views[i];
          if (!!view.$scope && view.$scope.bindingContext[local] === item) {
            view.$bind(flags, Scope.fromParent($scope, view.$scope.bindingContext));
          } else {
            view.$bind(flags, Scope.fromParent($scope, BindingContext.create(local, item)));
          }
        });
      } else {
        forOf.iterate(items, (arr, i, item) => {
          const view = views[i];
          if (indexMap[i] === i) {
            view.$bind(flags, Scope.fromParent($scope, view.$scope.bindingContext));
          } else {
            view.$bind(flags, Scope.fromParent($scope, BindingContext.create(local, item)));
          }
        });
      }
    }

    if (this.$state & LifecycleState.isAttached) {
      const { location } = this;
      if (indexMap === null) {
        for (let i = 0, ii = views.length; i < ii; ++i) {
          const view = views[i];
          view.hold(location);
          view.$attach(this.encapsulationSource, LifecycleFlags.fromBindableHandler);
        }
      } else {
        for (let i = 0, ii = views.length; i < ii; ++i) {
          if (indexMap[i] !== i) {
            const view = views[i];
            view.hold(location);
            view.$attach(this.encapsulationSource, LifecycleFlags.fromBindableHandler);
          }
        }
      }
    }
  }

  private checkCollectionObserver(): void {
    const oldObserver = this.observer;
    if (this.$state & LifecycleState.isBound) {
      const newObserver = this.observer = getCollectionObserver(this.changeSet, this.items);
      if (oldObserver !== newObserver) {
        if (oldObserver) {
          oldObserver.unsubscribeBatched(this);
        }
        if (newObserver) {
          newObserver.subscribeBatched(this);
        }
      }
    } else if (oldObserver) {
      oldObserver.unsubscribeBatched(this);
    }
  }
}
