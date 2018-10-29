import { Constructable, Immutable, inject } from '@aurelia/kernel';
import {
  IHydrateElementInstruction,
  ITargetedInstruction,
  ITemplateDefinition,
  TargetedInstruction,
  TemplateDefinition
} from '../../definitions';
import { INode } from '../../dom';
import { IAttachLifecycle, IDetachLifecycle } from '../../lifecycle';
import { LifecycleFlags, IChangeSet } from '../../observation';
import { bindable } from '../bindable';
import { createElement, RenderPlan } from '../create-element';
import { customElement, ICustomElement } from '../custom-element';
import { IRenderable, IRenderingEngine } from '../rendering-engine';
import { IView, IViewFactory } from '../view';
import { CompositionCoordinator } from './composition-coordinator';

const composeSource: ITemplateDefinition = {
  name: 'au-compose',
  containerless: true
};

const composeProps = ['subject', 'composing'];

type Subject = IViewFactory | IView | RenderPlan | Constructable | TemplateDefinition;

export interface Compose extends ICustomElement {}
@customElement(composeSource)
@inject(IChangeSet, IRenderable, ITargetedInstruction, IRenderingEngine)
export class Compose {
  @bindable public subject: Subject | Promise<Subject> = null;
  @bindable public composing: boolean = false;

  private properties: Record<string, TargetedInstruction> = null;
  private coordinator: CompositionCoordinator;
  private lastSubject: Subject | Promise<Subject> = null;

  constructor(
    public readonly changeSet: IChangeSet,
    private renderable: IRenderable,
    instruction: Immutable<IHydrateElementInstruction>,
    private renderingEngine: IRenderingEngine
  ) {
    this.coordinator = new CompositionCoordinator(this.changeSet);
    this.coordinator.onSwapComplete = () => {
      this.composing = false;
    };

    this.properties = instruction.instructions
      .filter((x: any) => !composeProps.includes(x.to))
      .reduce((acc, item: any) => {
        if (item.to) {
          acc[item.to] = item;
        }

        return acc;
      }, {});
  }

  public binding(flags: LifecycleFlags): void {
    this.startComposition(this.subject);
    this.coordinator.binding(flags, this.$scope);
  }

  public attaching(encapsulationSource: INode, flags: LifecycleFlags): void {
    this.coordinator.attaching(encapsulationSource, flags);
  }

  public detaching(flags: LifecycleFlags): void {
    this.coordinator.detaching(flags);
  }

  public unbinding(flags: LifecycleFlags): void {
    this.lastSubject = null;
    this.coordinator.unbinding(flags);
  }

  public caching(): void {
    this.coordinator.caching();
  }

  public subjectChanged(newValue: any): void {
    this.startComposition(newValue);
  }

  private startComposition(subject: any): void {
    if (this.lastSubject === subject) {
      return;
    }

    this.lastSubject = subject;

    if (subject instanceof Promise) {
      subject = subject.then(x => this.resolveView(x));
    } else {
      subject = this.resolveView(subject);
    }

    this.composing = true;
    this.coordinator.compose(subject);
  }

  private resolveView(subject: Subject): IView {
    const view = this.provideViewFor(subject);

    if (view) {
      view.hold(this.$projector.host);
      view.lockScope(this.renderable.$scope);
      return view;
    }

    return null;
  }

  private provideViewFor(subject: Subject): IView | null {
    if (!subject) {
      return null;
    }

    if ('lockScope' in subject) { // IView
      return subject;
    }

    if ('createView' in subject) { // RenderPlan
      return subject.createView(
        this.renderingEngine,
        this.renderable.$context
      );
    }

    if ('create' in subject) { // IViewFactory
      return subject.create();
    }

    if ('template' in subject) { // Raw Template Definition
      return this.renderingEngine.getViewFactory(
        subject,
        this.renderable.$context
      ).create();
    }

    // Constructable (Custom Element Constructor)
    return createElement(
      subject,
      this.properties,
      this.$projector.children
    ).createView(
      this.renderingEngine,
      this.renderable.$context
    );
  }
}
