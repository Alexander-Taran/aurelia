import { DI, Reporter } from '@aurelia/kernel';
import { INode, INodeSequence, IRenderLocation } from '../dom';
import { IAttach, IAttachLifecycle, IBindScope, IDetachLifecycle, IMountable, LifecycleState, Lifecycle } from '../lifecycle';
import { LifecycleFlags, IScope } from '../observation';
import { IRenderable, IRenderContext, ITemplate } from './rendering-engine';

export type RenderCallback = (view: IView) => void;

export interface IView extends IBindScope, IRenderable, IAttach, IMountable {
  readonly cache: IViewCache;

  hold(location: IRenderLocation): void;
  release(): boolean;

  lockScope(scope: IScope): void;
}

export interface IViewFactory extends IViewCache {
  readonly name: string;
  create(): IView;
}

export interface IViewCache {
  readonly isCaching: boolean;
  setCacheSize(size: number | '*', doNotOverrideIfAlreadySet: boolean): void;
  canReturnToCache(view: IView): boolean;
  tryReturnToCache(view: IView): boolean;
}

export const IViewFactory = DI.createInterface<IViewFactory>().noDefault();

/*@internal*/
export interface View extends IView {}

/*@internal*/
export class View implements IView {
  public $bindableHead: IBindScope = null;
  public $bindableTail: IBindScope = null;

  public $nextBind: IBindScope = null;
  public $prevBind: IBindScope = null;

  public $attachableHead: IAttach = null;
  public $attachableTail: IAttach = null;

  public $nextAttach: IAttach = null;
  public $prevAttach: IAttach = null;

  // Pre-setting to null for performance (see RuntimeBehavior.create())
  public $nextMount: IMountable = null;

  public $state: LifecycleState = LifecycleState.none;
  public $scope: IScope = null;
  public $nodes: INodeSequence;
  public $context: IRenderContext;
  public location: IRenderLocation;
  private isFree: boolean = false;

  constructor(public cache: IViewCache) {}

  public hold(location: IRenderLocation): void {
    if (!location.parentNode) { // unmet invariant: location must be a child of some other node
      throw Reporter.error(60); // TODO: organize error codes
    }
    this.location = location;
    const lastChild = this.$nodes.lastChild;
    if (lastChild && lastChild.nextSibling === location) {
      this.$state &= ~LifecycleState.needsMount;
    } else {
      this.$state |= LifecycleState.needsMount;
    }
  }

  public lockScope(scope: IScope): void {
    this.$scope = scope;
    this.$bind = lockedBind;
  }

  public release(): boolean {
    this.isFree = true;
    if (this.$state & LifecycleState.isAttached) {
      return this.cache.canReturnToCache(this);
    }

    return this.$unmount(LifecycleFlags.fromRelease);
  }

  public $bind(flags: LifecycleFlags, scope: IScope): void {
    flags |= LifecycleFlags.fromBind;

    if (this.$state & LifecycleState.isBound) {
      if (this.$scope === scope) {
        return;
      }

      this.$unbind(flags);
    }
    // add isBinding flag
    this.$state |= LifecycleState.isBinding;

    this.$scope = scope;
    let current = this.$bindableHead;
    while (current !== null) {
      current.$bind(flags, scope);
      current = current.$nextBind;
    }

    // add isBound flag and remove isBinding flag
    this.$state |= LifecycleState.isBound;
    this.$state &= ~LifecycleState.isBinding;
  }

  public $unbind(flags: LifecycleFlags): void {
    if (this.$state & LifecycleState.isBound) {
      // add isUnbinding flag
      this.$state |= LifecycleState.isUnbinding;

      flags |= LifecycleFlags.fromUnbind;

      let current = this.$bindableTail;
      while (current !== null) {
        current.$unbind(flags);
        current = current.$prevBind;
      }

      // remove isBound and isUnbinding flags
      this.$state &= ~(LifecycleState.isBound | LifecycleState.isUnbinding);
      this.$scope = null;
    }
  }

  public $attach(encapsulationSource: INode, flags: LifecycleFlags): void {
    if (this.$state & LifecycleState.isAttached) {
      return;
    }
    // add isAttaching flag
    this.$state |= LifecycleState.isAttaching;
    flags |= LifecycleFlags.fromAttach;

    if (this.$state & LifecycleState.needsMount) {
      Lifecycle.queueMount(this, flags);
    }

    let current = this.$attachableHead;
    while (current !== null) {
      current.$attach(encapsulationSource, flags);
      current = current.$nextAttach;
    }

    if (this.$state & LifecycleState.needsMount) {
      Lifecycle.unqueueMount();
    }

    // add isAttached flag, remove isAttaching flag
    this.$state |= LifecycleState.isAttached;
    this.$state &= ~LifecycleState.isAttaching;
  }

  public $detach(flags: LifecycleFlags): void {
    if (this.$state & LifecycleState.isAttached) {
      // add isDetaching flag
      this.$state |= LifecycleState.isDetaching;
      flags |= LifecycleFlags.fromDetach;

      Lifecycle.queueUnmount(this, flags);

      let current = this.$attachableTail;
      while (current !== null) {
        current.$detach(flags);
        current = current.$prevAttach;
      }

      Lifecycle.unqueueUnmount();

      // remove isAttached and isDetaching flags
      this.$state &= ~(LifecycleState.isAttached | LifecycleState.isDetaching);
    }
  }

  public $mount(flags: LifecycleFlags): void {
    this.$state &= ~LifecycleState.needsMount;
    this.$nodes.insertBefore(this.location);
  }

  public $unmount(flags: LifecycleFlags): boolean {
    this.$state |= LifecycleState.needsMount;
    this.$nodes.remove();

    if (this.isFree) {
      this.isFree = false;
      if (this.cache.tryReturnToCache(this)) {
        this.$state |= LifecycleState.isCached;
        return true;
      }
    }
    return false;
  }

  public $cache(): void {
    let current = this.$attachableTail;
    while (current !== null) {
      current.$cache();
      current = current.$prevAttach;
    }
  }
}

/*@internal*/
export class ViewFactory implements IViewFactory {
  public static maxCacheSize: number = 0xFFFF;
  public isCaching: boolean = false;

  private cacheSize: number = -1;
  private cache: View[] = null;

  constructor(public name: string, private template: ITemplate) {}

  public setCacheSize(size: number | '*', doNotOverrideIfAlreadySet: boolean): void {
    if (size) {
      if (size === '*') {
        size = ViewFactory.maxCacheSize;
      } else if (typeof size === 'string') {
        size = parseInt(size, 10);
      }

      if (this.cacheSize === -1 || !doNotOverrideIfAlreadySet) {
        this.cacheSize = size;
      }
    }

    if (this.cacheSize > 0) {
      this.cache = [];
    } else {
      this.cache = null;
    }

    this.isCaching = this.cacheSize > 0;
  }

  public canReturnToCache(view: IView): boolean {
    return this.cache !== null && this.cache.length < this.cacheSize;
  }

  public tryReturnToCache(view: View): boolean {
    if (this.canReturnToCache(view)) {
      view.$cache();
      this.cache.push(view);
      return true;
    }

    return false;
  }

  public create(): IView {
    const cache = this.cache;
    let view: View;

    if (cache !== null && cache.length > 0) {
      view = cache.pop();
      view.$state &= ~LifecycleState.isCached;
      return view;
    }

    view = new View(this);
    this.template.render(view);
    if (!view.$nodes) {
      throw Reporter.error(90);
    }
    return view;
  }
}

function lockedBind(this: View, flags: LifecycleFlags): void {
  if (this.$state & LifecycleState.isBound) {
    return;
  }

  flags |= LifecycleFlags.fromBind;
  const lockedScope = this.$scope;
  let current = this.$bindableHead;
  while (current !== null) {
    current.$bind(flags, lockedScope);
    current = current.$nextBind;
  }

  this.$state |= LifecycleState.isBound;
}
