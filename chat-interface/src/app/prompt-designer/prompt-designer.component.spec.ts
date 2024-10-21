import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PromptDesignerComponent } from './prompt-designer.component';

describe('PromptDesignerComponent', () => {
  let component: PromptDesignerComponent;
  let fixture: ComponentFixture<PromptDesignerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PromptDesignerComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PromptDesignerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
