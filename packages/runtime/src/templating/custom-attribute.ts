import {
  Constructable,
  Decoratable,
  Decorated,
  IContainer,
  Immutable,
  Omit,
  PLATFORM,
  Registration,
  Writable
} from '@aurelia/kernel';
import { BindingMode } from '../binding/binding-mode';
import { IAttributeDefinition } from '../definitions';
import { INode } from '../dom';
import { IAttach, IAttachLifecycle, IBindScope, IDetachLifecycle, ILifecycleHooks, ILifecycleState, LifecycleHooks, LifecycleState, Lifecycle } from '../lifecycle';
import { LifecycleFlags, IScope } from '../observation';
import { IResourceKind, IResourceType, ResourceDescription } from '../resource';
import { IRenderable, IRenderingEngine } from './rendering-engine';
import { IRuntimeBehavior } from './runtime-behavior';

export interface ICustomAttributeType extends
  IResourceType<IAttributeDefinition, ICustomAttribute>,
  Immutable<Pick<Partial<IAttributeDefinition>, 'bindables'>> { }

type OptionalLifecycleHooks = ILifecycleHooks & Omit<IRenderable, Exclude<keyof IRenderable, '$mount' | '$unmount'>>;
type RequiredLifecycleProperties = Readonly<Pick<IRenderable, '$scope'>> & ILifecycleState;

export interface ICustomAttribute extends IBindScope, IAttach, OptionalLifecycleHooks, RequiredLifecycleProperties {
  $hydrate(renderingEngine: IRenderingEngine): void;
}

/*@internal*/
export interface IInternalCustomAttributeImplementation extends Writable<ICustomAttribute> {
  $behavior: IRuntimeBehavior;
}

type CustomAttributeDecorator = <T extends Constructable>(target: Decoratable<ICustomAttribute, T>) => Decorated<ICustomAttribute, T> & ICustomAttributeType;
/**
 * Decorator: Indicates that the decorated class is a custom attribute.
 */
export function customAttribute(nameOrDef: string | IAttributeDefinition): CustomAttributeDecorator {
  return target => CustomAttributeResource.define(nameOrDef, target);
}

/**
 * Decorator: Applied to custom attributes. Indicates that whatever element the
 * attribute is placed on should be converted into a template and that this
 * attribute controls the instantiation of the template.
 */
export function templateController(nameOrDef: string | Omit<IAttributeDefinition, 'isTemplateController'>): CustomAttributeDecorator {
  return target => CustomAttributeResource.define(
    typeof nameOrDef === 'string'
    ? { isTemplateController: true , name: nameOrDef }
    : { isTemplateController: true, ...nameOrDef },
    target);
}

export const CustomAttributeResource: IResourceKind<IAttributeDefinition, ICustomAttributeType> = {
  name: 'custom-attribute',

  keyFrom(name: string): string {
    return `${this.name}:${name}`;
  },

  isType<T extends Constructable & Partial<ICustomAttributeType>>(Type: T): Type is T & ICustomAttributeType {
    return Type.kind === this;
  },

  define<T extends Constructable>(nameOrSource: string | IAttributeDefinition, ctor: T): T & ICustomAttributeType {
    const Type = ctor as Writable<ICustomAttributeType> & T;
    const proto: ICustomAttribute = Type.prototype;
    const description = createCustomAttributeDescription(typeof nameOrSource === 'string' ? { name: nameOrSource } : nameOrSource, <T & ICustomAttributeType>Type);

    Type.kind = CustomAttributeResource;
    Type.description = description;
    Type.register = register;

    proto.$hydrate = hydrate;
    proto.$bind = bind;
    proto.$attach = attach;
    proto.$detach = detach;
    proto.$unbind = unbind;
    proto.$cache = cache;

    return <ICustomAttributeType & T>Type;
  }
};

function register(this: ICustomAttributeType, container: IContainer): void {
  const description = this.description;
  const resourceKey = CustomAttributeResource.keyFrom(description.name);
  const aliases = description.aliases;

  container.register(Registration.transient(resourceKey, this));

  for (let i = 0, ii = aliases.length; i < ii; ++i) {
    const aliasKey = CustomAttributeResource.keyFrom(aliases[i]);
    container.register(Registration.alias(resourceKey, aliasKey));
  }
}

function hydrate(this: IInternalCustomAttributeImplementation, renderingEngine: IRenderingEngine): void {
  const Type = this.constructor as ICustomAttributeType;

  this.$state = LifecycleState.none;
  this.$scope = null;

  renderingEngine.applyRuntimeBehavior(Type, this);

  if (this.$behavior.hooks & LifecycleHooks.hasCreated) {
    this.created();
  }
}

function bind(this: IInternalCustomAttributeImplementation, flags: LifecycleFlags, scope: IScope): void {
  flags |= LifecycleFlags.fromBind;

  if (this.$state & LifecycleState.isBound) {
    if (this.$scope === scope) {
      return;
    }

    this.$unbind(flags);
  }
  // add isBinding flag
  this.$state |= LifecycleState.isBinding;

  const hooks = this.$behavior.hooks;

  if (hooks & LifecycleHooks.hasBound) {
    Lifecycle.queueBound(this, flags);
  }

  this.$scope = scope;

  if (hooks & LifecycleHooks.hasBinding) {
    this.binding(flags);
  }

  // add isBound flag and remove isBinding flag
  this.$state |= LifecycleState.isBound;
  this.$state &= ~LifecycleState.isBinding;

  if (hooks & LifecycleHooks.hasBound) {
    Lifecycle.unqueueBound();
  }
}

function unbind(this: IInternalCustomAttributeImplementation, flags: LifecycleFlags): void {
  if (this.$state & LifecycleState.isBound) {
    // add isUnbinding flag
    this.$state |= LifecycleState.isUnbinding;

    const hooks = this.$behavior.hooks;
    flags |= LifecycleFlags.fromUnbind;

    if (hooks & LifecycleHooks.hasUnbound) {
      Lifecycle.queueUnbound(this, flags);
    }

    if (hooks & LifecycleHooks.hasUnbinding) {
      this.unbinding(flags);
    }

    // remove isBound and isUnbinding flags
    this.$state &= ~(LifecycleState.isBound | LifecycleState.isUnbinding);

    if (hooks & LifecycleHooks.hasUnbound) {
      Lifecycle.unqueueUnbound();
    }
  }
}

function attach(this: IInternalCustomAttributeImplementation, encapsulationSource: INode, flags: LifecycleFlags): void {
  if (this.$state & LifecycleState.isAttached) {
    return;
  }

  // add isAttaching flag
  this.$state |= LifecycleState.isAttaching;
  flags |= LifecycleFlags.fromAttach;

  const hooks = this.$behavior.hooks;

  if (hooks & LifecycleHooks.hasAttaching) {
    this.attaching(encapsulationSource, flags);
  }

  // add isAttached flag, remove isAttaching flag
  this.$state |= LifecycleState.isAttached;
  this.$state &= ~LifecycleState.isAttaching;

  if (hooks & LifecycleHooks.hasAttached) {
    Lifecycle.queueAttached(this, flags);
  }
}

function detach(this: IInternalCustomAttributeImplementation, flags: LifecycleFlags): void {
  if (this.$state & LifecycleState.isAttached) {
    // add isDetaching flag
    this.$state |= LifecycleState.isDetaching;
    flags |= LifecycleFlags.fromDetach;

    const hooks = this.$behavior.hooks;
    if (hooks & LifecycleHooks.hasDetaching) {
      this.detaching(flags);
    }

    // remove isAttached and isDetaching flags
    this.$state &= ~(LifecycleState.isAttached | LifecycleState.isDetaching);

    if (hooks & LifecycleHooks.hasDetached) {
      Lifecycle.queueDetached(this, flags);
    }
  }
}

function cache(this: IInternalCustomAttributeImplementation): void {
  if (this.$behavior.hooks & LifecycleHooks.hasCaching) {
    this.caching();
  }
}

/*@internal*/
export function createCustomAttributeDescription(def: IAttributeDefinition, Type: ICustomAttributeType): ResourceDescription<IAttributeDefinition> {
  return {
    name: def.name,
    aliases: def.aliases || PLATFORM.emptyArray,
    defaultBindingMode: def.defaultBindingMode || BindingMode.toView,
    isTemplateController: def.isTemplateController || false,
    bindables: {...Type.bindables, ...def.bindables}
  };
}
